import c from 'ansi-colors';
import { allKeywords } from './constants.mjs';
import { Gitlab } from '@gitbeaker/rest';

const warn = (message) => {
  console.log(`${c.yellowBright('[WARN]')} ${message}`);
};
const ensureEnvironment = (names) => {
  return names
    .map((name) => (process.env[[name]] ? undefined : name))
    .filter((message) => message !== undefined);
};

const getImage = (obj) => {
  if (typeof obj === 'string') {
    return obj;
  }
  if (Object.hasOwn(obj, 'name')) {
    return obj.name;
  }
  throw new Error('Cannot determine image');
};

const collectData = async () => {
  const api = new Gitlab({
    token: process.env.ACCESS_TOKEN,
    host: process.env.CI_SERVER_URL,
  });

  const oldest = new Date();
  oldest.setFullYear(oldest.getFullYear() - 1);
  const pipelines = await api.Pipelines.all(process.env.CI_PROJECT_ID, {
    status: 'success',
    updatedAfter: oldest.toISOString(),
    maxPages: 1,
    perPage: 20,
  });

  const pipelineInfo = [];

  for (const pipeline of pipelines) {
    const jobs = (
      await api.Jobs.all(process.env.CI_PROJECT_ID, { pipelineId: pipeline.id })
    ).map((job) => {
      return {
        name: job.name,
        duration: job.duration,
        artifacts: job.artifacts.reduce(
          (previous, artifact) => previous + artifact.size,
          0,
        ),
      };
    });
    pipelineInfo.push({
      url: pipeline.web_url,
      duration:
        (new Date(pipeline.updated_at) - new Date(pipeline.created_at)) / 1000,
      jobs,
    });
  }
  return pipelineInfo;
};

const imageSize = async (image) => {
  if (!process.env.DOCKER_V2_URL) {
    return 0;
  }
  try {
    const filter = new URL(
      `https://${image.match(/^([\w-]+\.[\w.-]+)/) ? image : 'my.host/' + image}`,
    );
    const info = filter.pathname.substring(1).split(':');
    if (info.length !== 2) {
      warn(`Cannot fetch image size for ${image} - no tag information.`);
      return 0;
    }
    const name = info[0];
    const tag = info[1];
    const headers = {
      headers: {
        Accept: 'application/vnd.docker.distribution.manifest.v2+json',
      },
    };
    if (process.env.DOCKER_TOKEN) {
      headers.headers['Authorization'] = `Bearer ${process.env.DOCKER_TOKEN}`;
    }
    const response = await fetch(
      `${process.env.DOCKER_V2_URL}/${name}/manifests/${tag}`,
      headers,
    );
    if (response.status === 200) {
      const manifest = await response.json();
      if (manifest.layers) {
        return manifest.layers.reduce(
          (previous, current) => previous + current.size,
          0,
        );
      }
    }
    warn(
      `Cannot fetch image size for ${process.env.DOCKER_V2_URL}/${name}/manifests/${tag} - manifest fetch error.`,
    );
    return 0;
  } catch (e) {
    warn(e.message);
    return 0;
  }
};

const adjustData = async (pipelines, images) => {
  const sizes = {};
  for (const image of images.map((item) => item.image)) {
    if (sizes[image] === undefined) {
      sizes[image] = await imageSize(image);
    }
  }
  for (const pipeline of pipelines) {
    for (const job of pipeline.jobs) {
      const data = images.find((item) => item.name === job.name);
      if (data) {
        job.image = data.image;
        job.imageSize = sizes[data.image] || 0;
      }
    }
    pipeline.imageSizes = pipeline.jobs.reduce(
      (previous, job) => previous + (job.imageSize || 0),
      0,
    );
  }
  return pipelines;
};

const mapJobs = (pipelines) => {
  const result = {};
  for (const pipeline of pipelines) {
    for (const job of pipeline.jobs) {
      if (!result[job.name]) {
        result[job.name] = [];
      }
      result[job.name].push({
        duration: job.duration,
        imageSize: job.imageSize || 0,
      });
    }
  }
  return result;
};

const percentiles = (data, property) => {
  if (data.length === 0) {
    return data;
  }
  if (!Object.hasOwn(data[0], property)) {
    throw new Error(`Invalid property ${property} for ${JSON.stringify(data[0])}`);
  }
  const list = [...data];
  list.sort((a, b) => typeof a[property] === 'number' ? a[property] - b[property] : a[property].localeCompare(b[property]));
  return [
    list[Math.floor(list.length / 2)],
    list[Math.floor((3 * list.length) / 4)],
    list[list.length - 1],
  ];
};

const formatUnit = (value, unit) => {
  switch (unit) {
    case 'KB':
      return (value / 1024).toFixed(2);
    case 'MB':
      return (value / (1024 * 1024)).toFixed(2);
    default:
      return value.toFixed(2);
  }
};
const formatPercentiles = (description, property, unit, indent, list, timeout) => {
  return [
    `${''.padEnd(indent)}${c.greenBright(description)}`,
    `${''.padEnd(indent + 2)}${c.white('Median         : ')} ${c.yellowBright(formatUnit(list[0][property], unit))}${unit}`,
    `${''.padEnd(indent + 2)}${c.white('75th Percentile: ')} ${c.yellowBright(formatUnit(list[1][property], unit))}${unit}`,
    `${''.padEnd(indent + 2)}${c.white('Max:           : ')} ${c.yellowBright(formatUnit(list[2][property], unit))}${unit}${timeout ? ' job timeout: ' + c.yellowBright(timeout) : ''} ${list[2].url || ''}`,
  ].join('\n');
};

export const analyzer = {
  id: 'jobs-analyzer',
  title: 'Job/pipeline analysis',
  severity: 'info',
  rule: (key, obj, depth, resolver, node) => {
    if (depth === 0 && key === 'image') {
      analyzer.defaultImage = getImage(node.value.toJSON());
      return;
    }
    if (depth === 0 && key === 'default') {
      if (Object.hasOwn(obj, 'image')) {
        analyzer.defaultImage = getImage(obj.image);
      }
      if (Object.hasOwn(obj, 'timeout')) {
        // according to GitLab this does not work, but
        // is just supported here for completeness
        analyzer.defaultTimeout = obj.timeout;
      }
      return;
    }
    if (depth === 0 && !allKeywords.has(key)) {
      if (key.startsWith('.')) {
        return undefined;
      }
      if (Object.hasOwn(obj, 'trigger')) {
        return undefined;
      }
      let imageUsed = analyzer.defaultImage;
      const full = resolver();
      if (Object.hasOwn(obj, 'image')) {
        imageUsed = getImage(obj.image);
      } else if (full && Object.hasOwn(full, 'image')) {
        imageUsed = getImage(full.image);
      }
      let timeout = analyzer.defaultTimeout;
      if (Object.hasOwn(obj, 'timeout')) {
        timeout = obj.timeout;
      } else if (full && Object.hasOwn(full, 'timeout')) {
        timeout = full.timeout;
      }
      if (!analyzer.timeouts) {
        analyzer.timeouts = {};
      }
      analyzer.timeouts[key] = timeout;
      if (imageUsed) {
        if (!analyzer.images) {
          analyzer.images = [];
        }
        analyzer.images.push({
          name: key,
          image: imageUsed,
        });
      }
    }
  },
  finally: async () => {
    if (!analyzer.images) {
      return {
        message:
          'Skipping analysis: Could not collect image usage information.',
      };
    }
    const missingVariables = ensureEnvironment([
      'ACCESS_TOKEN',
      'CI_PROJECT_ID',
      'CI_SERVER_URL',
    ]);
    if (missingVariables.length > 0) {
      return {
        message: `Skipping analysis: Required environment variables not set (${missingVariables.join(', ')}).`,
      };
    }
    if (ensureEnvironment(['DOCKER_V2_URL']).length > 0) {
      warn(
        'Environment variable DOCKER_V2_URL is required to determine image sizes (DOCKER_TOKEN optional).',
      );
    }
    const pipelines = await adjustData(await collectData(), analyzer.images);
    const jobs = mapJobs(pipelines);
    const description = [
      `  ${c.magentaBright('Pipeline:')}`,
      `${formatPercentiles('Duration:', 'duration', 's', 4, percentiles(pipelines, 'duration'))}`,
      `${formatPercentiles('Accumulated images size:', 'imageSizes', 'KB', 4, percentiles(pipelines, 'imageSizes'))}`,
      `    ${c.greenBright('Unique images:')}\n      ${Array.from(new Set(analyzer.images ? analyzer.images.map((item) => item.image) : [])).join(',')}`,
      `  ${c.magentaBright('Jobs:')}`,
    ];
    analyzer.description =
      `  ${c.magentaBright('Pipeline:')}\n` +
      `${formatPercentiles('Duration:', 'duration', 's', 4, percentiles(pipelines, 'duration'))}\n` +
      `${formatPercentiles('Accumulated images size:', 'imageSizes', 'KB', 4, percentiles(pipelines, 'imageSizes'))}\n` +
      `  ${c.magentaBright('Jobs:')}\n`;
    for (const job in jobs) {
      description.push(`    ${c.cyanBright(job)}:`);
      description.push(
        `${formatPercentiles('Duration:', 'duration', 's', 6, percentiles(jobs[job], 'duration'), analyzer.timeouts[job])}`,
      );
      description.push(
        `      ${c.greenBright('Image size:')}      :  ${c.yellowBright(formatUnit(jobs[job][0].imageSize, 'KB'))}KB`,
      );
    }
    analyzer.description = description.join('\n');
    analyzer.literal = true;
    return {
      message: 'Data collection results:',
    };
  },
};
