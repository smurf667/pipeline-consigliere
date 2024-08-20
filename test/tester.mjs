#!/usr/bin/env node

import c from 'ansi-colors';
import fs from 'fs';
import { execFileSync } from 'child_process';

const root = './test/pipelines';
const build = './build';
if (fs.existsSync(build)) {
  fs.rmSync(build, { recursive: true, force: true });
}
fs.mkdirSync('./build');
const errors = fs.readdirSync(root)
  .filter(file => file.endsWith('.yml'))
  .map(file => {
    const expectations = JSON.parse(fs.readFileSync(`${root}/${file.replace('yml', 'json')}`, 'utf8'));
    const args = ['./bin/cli.mjs', `${root}/${file}`];
    if (expectations.fixes > 0) {
      args.push('--fix');
      args.push('--out');
      args.push(`./build/${file}`);
    }
    try {
      console.log(`${c.whiteBright('Running')} node ${args.join(' ')}`);
      const stdout = execFileSync('node', args, {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      const summary = `Errors: ${expectations.error} Warnings: ${expectations.warn} Notifications: ${expectations.info}`;
      if (stdout.indexOf(summary) < 0) {
        const actual = stdout.match(/^Errors.+$/gm);
        return `Unexpected summary for ${file}. Wanted "${summary}" but got "${actual ? actual[0] : 'nothing'}".`;
      }
    } catch (err) {
      if (err.code) {
        console.error(err.code);
      } else {
        const { stdout, stderr } = err;
        console.error({ stdout, stderr });
      }
      return `Error running ${args.join(' ')}`;
    }
    if (expectations.fixes > 0) {
      const actualFile = `./build/${file}`;
      if (!fs.existsSync(actualFile)) {
        return `${actualFile} does not exist`;
      }
      const actual = fs.readFileSync(actualFile, 'utf8').toString();
      const expectedFile = `${root}/${file.replace('yml', 'expected')}`;
      const expected = fs.readFileSync(expectedFile, 'utf8').toString();
      if (actual !== expected) {
        return `Fixed file ${actualFile} does not have content of ${expectedFile}`;
      }
    }
  })
  .filter(message => message !== undefined);

if (errors.length > 0) {
  console.log(c.redBright('\nError!'));
  errors.forEach(message => console.log(`  ${message}`));
} else {
  console.log(c.greenBright('\nSuccess!'));
}
