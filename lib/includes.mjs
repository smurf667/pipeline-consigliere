import fs from 'fs';
import YAML from 'yaml';
import c from 'ansi-colors';
import path from 'path';

const warn = (message) => console.log(`${c.yellowBright('[WARN]')} ${message}`);
const resolveVariables = (str) =>
  str.replace(/\$([A-Z_]+[A-Z]?)/g, (_, name) => process.env[name] || name);

const handleLocalInclude = async (include) => {
  const filename = path.resolve(
    process.cwd(),
    resolveVariables(
      include.local.startsWith('/')
        ? include.local.substring(1)
        : include.local,
    ),
  );
  if (!fs.existsSync(filename)) {
    warn(`${filename} does not exist`);
    return;
  }
  return [YAML.parseDocument(fs.readFileSync(filename, 'utf8'))];
};

const handleRemoteInclude = async (target) => {
  const url = resolveVariables(target);
  const response = await fetch(url);
  if (response.status !== 200) {
    return;
  }
  return [YAML.parseDocument(await response.text())];
};

const handleProjectInclude = async (include) => {
  const apiURL = process.env['CI_API_V4_URL'];
  if (!apiURL) {
    warn(
      `The environment variable CI_API_V4_URL must be set in order to resolve project references. Skipping ${include.project}.`,
    );
    return;
  }
  const token = process.env['ACCESS_TOKEN'];
  if (!token) {
    warn(
      `The environment variable ACCESS_TOKEN (repository read) must be set in order to resolve project references. Skipping ${include.project}.`,
    );
    return;
  }
  let files = [include.file];
  if (Array.isArray(include.file)) {
    files = include.file;
  }
  const project = encodeURIComponent(resolveVariables(include.project));
  const result = [];
  for (const target of files) {
    const file = encodeURIComponent(target);
    const url = `${apiURL}/projects/${project}/repository/files/${file}/raw${include.ref ? '?ref=' + include.ref : ''}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (response.status === 200) {
      result.push(YAML.parseDocument(await response.text()));
    } else {
      warn(`Error fetching ${url}`);
    }
  }
  return result.length > 0 ? result : undefined;
};

export const handleInclude = async (include) => {
  if (typeof include === 'string') {
    if (include.startsWith('http')) {
      return await handleRemoteInclude(include);
    }
    return await handleLocalInclude({ local: include });
  }
  if (Object.hasOwn(include, 'local')) {
    return await handleLocalInclude(include);
  }
  if (Object.hasOwn(include, 'remote')) {
    return await handleRemoteInclude(include.remote);
  }
  if (Object.hasOwn(include, 'project')) {
    return await handleProjectInclude(include);
  }
  warn(`Cannot handle ${JSON.stringify(include)}`);
};
