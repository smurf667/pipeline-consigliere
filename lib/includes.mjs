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

const replaceComponentVariables = (commponent, template) => {
  const inputs = commponent.spec?.inputs || {};
  function resolvePlaceholder(path) {
    const parts = path.split('.');
    let value = { inputs };
    for (const key of parts) {
      if (value?.[key] == null) {
        break;
      }
      value = value?.[key];
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'object' && 'default' in value) {
      return value.default;
    }
    warn(`Could not resolve placeholder ${path} in component inputs`);
    return 'UNRESOLVED_PLACEHOLDER';
  }
  function resolvePlaceholders(obj) {
    if (typeof obj === 'string') {
      return obj.replace(
        /\$\[\[\s*(.*?)\s*\]\]/g,
        (_, path) => resolvePlaceholder(path) || `$[[ ${path} ]]`,
      );
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => resolvePlaceholders(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          resolvePlaceholders(key),
          resolvePlaceholders(value),
        ]),
      );
    }
    return obj;
  }
  return resolvePlaceholders(template);
};

const handleComponentInclude = async (include) => {
  const apiURL = process.env['CI_API_V4_URL'];
  if (!apiURL) {
    warn(
      `The environment variable CI_API_V4_URL must be set in order to resolve component references. Skipping ${include.component}.`,
    );
    return;
  }
  const token = process.env['ACCESS_TOKEN'];
  if (!token) {
    warn(
      `The environment variable ACCESS_TOKEN (repository read) must be set in order to resolve component references. Skipping ${include.component}.`,
    );
    return;
  }
  const parts = include.component.split('@');
  if (parts.length !== 2) {
    warn(
      `Invalid component reference ${include.component}. Expected format: component@version. Skipping ${include.component}.`,
    );
    return;
  }
  const segments = parts[0].split('/');
  const file = encodeURIComponent(`templates/${segments.pop()}.yml`);
  // assume the component source is readable via API
  const component = encodeURIComponent(
    resolveVariables(segments.join('/'))
      .replace(process.env['CI_SERVER_FQDN'] || '', '')
      .replace(/^\/?/, ''),
  );
  const version = parts[1] === 'latest' ? '' : `?ref=${parts[1]}`;
  const url = `${apiURL}/projects/${component}/repository/files/${file}/raw${version}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (response.status === 200) {
    const [component, template] = YAML.parseAllDocuments(
      await response.text(),
    ).map((doc) => doc.toJSON());
    if (component === undefined || template === undefined) {
      warn(`Could not get component documents for ${url}`);
      return;
    }
    if (include.inputs && component.spec?.inputs) {
      function deepMerge(target, source) {
        for (const key in source) {
          if (source[key] instanceof Object && key in target) {
            Object.assign(source[key], deepMerge(target[key], source[key]));
          }
        }
        Object.assign(target || {}, source);
        return target;
      }
      deepMerge(component.spec.inputs, include.inputs);
    }
    // TODO what about includes in the spec? currently ignored
    const result = replaceComponentVariables(component, template);
    result.toJSON = () => result;
    return [result];
  } else {
    warn(`Error fetching ${url}`);
  }
  return undefined;
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
  if (Object.hasOwn(include, 'component')) {
    return await handleComponentInclude(include);
  }
  warn(`Cannot handle ${JSON.stringify(include)}`);
};
