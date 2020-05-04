// TODO: equal 50/50 ham vs. spam dataset
// TODO: test classifier.json against dataset to determine percentage accuracy

const fs = require('fs');
const os = require('os');
const path = require('path');

const NaiveBayes = require('naivebayes');
const cryptoRandomString = require('crypto-random-string');
const pMap = require('p-map');
const { readDirDeep } = require('read-dir-deep');

const SpamScanner = require('.');

const concurrency = os.cpus().length;

const randomOptions = {
  length: 10,
  characters: 'abcdefghijklmnopqrstuvwxyz'
};

// simply delete the replacements.json to generate new replacements
let replacements;
try {
  replacements = require('./replacements.json');
} catch (err) {
  console.error(err);
  console.log('generating new replacements.json');
  replacements = {
    url: `url${cryptoRandomString(randomOptions)}`,
    email: `email${cryptoRandomString(randomOptions)}`,
    number: `number${cryptoRandomString(randomOptions)}`,
    currency: `currency${cryptoRandomString(randomOptions)}`,
    initialism: `initialism${cryptoRandomString(randomOptions)}`,
    abbreviation: `abbreviation${cryptoRandomString(randomOptions)}`
  };
}

// simply delete the classifier.json to retrain from scratch
let json;
try {
  json = require('./classifier.json');
  console.log('re-training with existing classifier');
} catch (err) {
  console.error(err);
  console.log('training new classifier');
}

function tokenizer(tokens) {
  return tokens;
}

let classifier;
if (json) {
  classifier = NaiveBayes.fromJson(json);
  classifier.tokenizer = tokenizer;
} else {
  classifier = new NaiveBayes({ tokenizer });
}

if (
  typeof process.env.SPAM_CATEGORY !== 'string' ||
  !['ham', 'spam'].includes(process.env.SPAM_CATEGORY)
)
  throw new Error('SPAM_CATEGORY environment variable missing');

if (typeof process.env.SCAN_DIRECTORY !== 'string')
  throw new Error('SCAN_DIRECTORY environment variable missing');

const scanner = new SpamScanner({
  replacements,
  classifier: true
});

async function mapper(source) {
  try {
    console.log('source', source);
    const { tokens } = await scanner.getTokensAndMailFromSource(source);
    if (tokens.length === 0) return;
    // to bias against false positives we can (at least for now)
    // take the token count for ham and double it (duplicate it)
    if (process.env.SPAM_CATEGORY === 'ham') {
      const { length } = tokens;
      // NOTE: concat is slower than push so we use push
      for (let i = 0; i < length; i++) {
        tokens.push(tokens[i]);
      }
    }

    classifier.learn(tokens, process.env.SPAM_CATEGORY);
  } catch (err) {
    console.log('source error', source);
    console.error(err);
  }
}

(async () => {
  // read directory for all files (i/o)
  console.time('sources');
  const dir = path.resolve(process.env.SCAN_DIRECTORY);

  const sources = await readDirDeep(dir, {
    ignore: [
      '**/Summary.txt',
      '**/cmds',
      '**/cmd',
      '**/index',
      '**/.DS_Store',
      '**/*.mbox'
    ]
  });
  console.timeEnd('sources');

  // process all token sets, this is an array of arrays
  // for each source it returns an array of stemmed tokens
  console.time('tokenSets');
  await pMap(sources, mapper, { concurrency });
  console.timeEnd('tokenSets');

  console.time('writing classifier.json');
  fs.writeFileSync(
    path.join(__dirname, 'classifier.json'),
    classifier.toJson()
  );
  console.timeEnd('writing classifier.json');

  console.time('writing replacements.json');
  fs.writeFileSync(
    path.join(__dirname, 'replacements.json'),
    JSON.stringify(replacements, null, 2)
  );
  console.timeEnd('writing replacements.json');
})();