#!/usr/bin/env node

import c from 'ansi-colors';
import defaultConfig from '../lib/config.mjs';
import fs from 'fs';
import prompts from 'prompts';
import { handleInclude } from '../lib/includes.mjs';
import YAML, { CST } from 'yaml';

const configFile = `${process.cwd()}/consigliere-config.mjs`;
const config = fs.existsSync(configFile)
  ? (await import(`file:${configFile}`)).default(defaultConfig)
  : defaultConfig;

const copyObj = (obj, anchorMap) => {
  if (obj === undefined) {
    return obj;
  }
  if (typeof obj === 'object') {
    if (Array.isArray(obj)) {
      return obj.map((entry) => copyObj(entry, anchorMap));
    }
    if (obj.source) {
      return copyObj(anchorMap[obj.source]);
    }
    const result = {};
    for (const k in obj) {
      if (typeof obj[k] === 'object' && obj[k] !== null) {
        result[k] = copyObj(obj[k], anchorMap);
      } else if (Object.hasOwn(obj, k)) {
        result[k] = copyObj(obj[k], anchorMap);
      }
    }
    return result;
  }
  return obj;
};

const resolve = (key, str, anchorMap, templateMap, fullDoc) => {
  const result = { ...fullDoc[key], ...JSON.parse(str)[key] };
  if (Object.hasOwn(result, 'extends')) {
    let names = result['extends'];
    if (!Array.isArray(names)) {
      names = [names];
    }
    delete result.extends;
    names.forEach((name) => {
      const parent = copyObj(templateMap[name], anchorMap);
      if (parent) {
        for (const k in parent) {
          if (Object.hasOwn(parent, k)) {
            result[k] = parent[k];
          }
        }
        if (Object.hasOwn(result, 'extends')) {
          throw new Error('Sorry, extension hierarchies are not yet supported');
        }
      } else {
        console.log(`${c.yellowBright('[WARN]')} Cannot find ${name}`, names);
      }
    });
  }
  return copyObj(result, anchorMap);
};

const buildMaps = (doc, anchorMap, templateMap) => {
  const includes = [];
  YAML.visit(doc, {
    Pair(_, node, path) {
      const depth = path.filter((e) => e instanceof YAML.YAMLMap).length - 1;
      if (node.value.anchor) {
        anchorMap[node.value.anchor] = node.value.toJSON();
      }
      if (node.key.value.startsWith('.') && depth === 0) {
        templateMap[node.key.value] = node.value.toJSON();
      }
      if (node.key.value === 'include' && depth === 0) {
        includes.push(node.value.toJSON());
      }
    },
  });
  return includes;
};

const wordWrap = (text, indent) =>
  `${text.replaceAll(/\s+/g, ' ')} `
    .replace(/(\S(.{0,74}\S)?)\s+/g, `${indent}$1\n`)
    .trim();

const printMessage = (item, message, linePos) => {
  let severityColor;
  switch (item.severity) {
    case 'info':
      severityColor = c.whiteBright;
      break;
    case 'warn':
      severityColor = c.yellowBright;
      break;
    case 'error':
      severityColor = c.redBright;
      break;
    default:
      severityColor = (s) => s;
      break;
  }
  console.log(
    `${severityColor('[' + item.severity.toLocaleUpperCase() + ']')} ${c.whiteBright(item.title)} ${linePos ? linePos : ''}`,
  );
  console.log(`  ${c.blueBright(message)}`);
  console.log(`  ${wordWrap(c.greenBright(item.description), '  ')}`);
};

const notIgnored = (node, id) =>
  !CST.stringify(node.srcToken).includes(`pipeline-consigliere-ignore ${id}`);

const handle = (summary, node, doc, key, obj, depth, resolver, linePos) => {
  config.rules.forEach((item) => {
    const { message, fix } =
      item.rule(key, obj, depth, resolver, node, doc) || {};
    if (message && notIgnored(node, item.id)) {
      const lineInfo = `(${linePos.line}:${linePos.col})`;
      printMessage(item, message, lineInfo);
      summary[item.severity]++;
      if (fix) {
        summary.fixes.push({
          id: item.id,
          severity: item.severity,
          message: message,
          line: linePos.line,
          fix,
        });
      }
    }
  });
};

const argv = process.argv.slice(2);
if (argv.find((arg) => arg === '--help') !== undefined) {
  console.log(
    c.whiteBright(
      `${process.argv[1]} [<pipeline-file>] [--fix] [--interactive] [--level <info|warn|error>] [--out <output-file>] [--help]`,
    ),
  );
  console.log(
    '  <pipeline-file>     name of pipeline file (defaults to .gitlab-ci.yml)',
  );
  console.log('  --fix               applies fixes, if possible');
  console.log('  --interactive       asks when fixing, if possible');
  console.log(
    '  --level <level>     the starting level to fix issues, defaults to info',
  );
  console.log('  --out <output-file> file to write if --fix is used');
  console.log('  --help              this help');
  console.log(c.whiteBright('\nActive rules:'));
  const padding = defaultConfig.rules.reduce((max, rule) =>
    max > rule.id.length ? max : rule.id.length,
  );
  defaultConfig.rules
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((rule) =>
      console.log(
        `  ${c.yellow(rule.id.padEnd(1 + padding, ' '))} ${c.greenBright(rule.title)}`,
      ),
    );
  const pkg = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  console.log(`\nDocumentation at ${pkg.homepage}`);
  process.exit(0);
}
let filename = '.gitlab-ci.yml';
if (argv.length > 0 && !argv[0].startsWith('-')) {
  filename = argv[0];
}
const applyFix = argv.find((arg) => arg === '--fix') !== undefined;
const interactive = argv.find((arg) => arg === '--interactive') !== undefined;
const outIndex = argv.findIndex((arg) => arg === '--out');
let outFile = filename;
if (outIndex >= 0 && argv.length > outIndex + 1) {
  outFile = argv[outIndex + 1];
}
const levelIndex = argv.findIndex((arg) => arg === '--level');
const fixLevels = new Set(['info', 'warn', 'error']);
if (levelIndex >= 0 && argv.length > levelIndex + 1) {
  switch (argv[levelIndex + 1]) {
    case 'warn':
      fixLevels.delete('info');
      break;
    case 'error':
      fixLevels.delete('info');
      fixLevels.delete('warn');
      break;
  }
}
if (!fs.existsSync(filename)) {
  console.log(c.redBright('Error! File does not exist:'), filename);
  process.exit(1);
}
const file = fs.readFileSync(filename, 'utf8');
const lineCounter = new YAML.LineCounter();
const doc = YAML.parseDocument(file, {
  lineCounter,
  keepSourceTokens: true,
});
if (doc.errors.length > 0) {
  console.log(
    `${c.yellowBright('[WARN]')} Parsing errors exist. Will attempt to continue.`,
  );
  doc.errors.forEach((err) =>
    console.log(`${c.redBright(err.code)} ${c.yellowBright(err.message)}`),
  );
}
const summary = {
  info: 0,
  warn: 0,
  error: 0,
  fixes: [],
};
const anchorMap = {};
const templateMap = {};
const subDocs = [];
let fullDoc = doc.toJSON();
const includes = buildMaps(doc, anchorMap, templateMap);
while (includes.length > 0) {
  const inc = includes.shift();
  if (typeof inc === 'string') {
    const subdocList = await handleInclude(inc);
    if (subdocList) {
      for (const subdoc of subdocList) {
        fullDoc = { ...fullDoc, ...subdoc.toJSON() };
        subDocs.push(subdoc);
        includes.push(...buildMaps(subdoc, anchorMap, templateMap));
      }
    }
  } else {
    for (const include of inc) {
      const subdocList = await handleInclude(include);
      if (subdocList) {
        for (const subdoc of subdocList) {
          fullDoc = { ...fullDoc, ...subdoc.toJSON() };
          subDocs.push(subdoc);
          includes.push(...buildMaps(subdoc, anchorMap, templateMap));
        }
      }
    }
  }
}

// run rules
YAML.visit(doc, {
  Pair(_, node, path) {
    const str = String(node);
    const obj = JSON.parse(str)[node.key.value];
    handle(
      summary,
      node,
      doc,
      node.key.value,
      obj,
      path.filter((e) => e instanceof YAML.YAMLMap).length - 1,
      str.indexOf('"source"') >= 0 ||
        Object.hasOwn(obj, 'extends') ||
        fullDoc[node.key.value]
        ? () => resolve(node.key.value, str, anchorMap, templateMap, fullDoc)
        : () => undefined,
      lineCounter.linePos(node.key.range[0]),
    );
  },
});

for (const item of config.rules) {
  if (Object.hasOwn(item, 'finally')) {
    const { message, fix } = (await item['finally'](doc, subDocs)) || {};
    if (message && notIgnored(doc.contents, item.id)) {
      printMessage(item, message);
      summary[item.severity]++;
      if (fix) {
        summary.fixes.push({
          id: item.id,
          severity: item.severity,
          message: message,
          fix,
        });
      }
    }
  }
}
console.log(
  `\nErrors: ${summary.error} Warnings: ${summary.warn} Notifications: ${summary.info}`,
);
const choices = [
  { title: 'Accept', value: 'Accept' },
  { title: 'Ignore', value: 'Ignore' },
  { title: 'Ignore all of these', value: 'IgnoreAll' },
];
if (summary.fixes.length > 0) {
  if (applyFix) {
    const ignorables = {};
    for (const fixItem of summary.fixes) {
      if (ignorables[fixItem.id] || !fixLevels.has(fixItem.severity)) {
        continue;
      }
      if (interactive) {
        const response = await prompts({
          type: 'select',
          name: 'value',
          message: `Handle [${fixItem.id}] ${fixItem.line ? 'for line ' + fixItem.line : ''}: ${fixItem.message}?`,
          choices,
          initial: 0,
        });
        if (response.value === 'Ignore') {
          continue;
        }
        if (response.value === 'IgnoreAll') {
          ignorables[fixItem.id] = true;
          continue;
        }
      }
      fixItem.fix();
    }
    if (outFile === '-') {
      console.log('modified file:');
      console.log(String(doc));
    } else {
      console.log('\nWriting fixed file', outFile);
      fs.writeFileSync(
        outFile,
        YAML.stringify(doc, {
          lineWidth: 0,
        }),
      );
    }
  } else {
    console.log(
      c.yellowBright(
        `${summary.fixes.length} fix${summary.fixes.length > 1 ? 'es' : ''} can be applied if the --fix flag is used.`,
      ),
    );
  }
}
