import { allKeywords } from './constants.mjs';

const jobsShouldBeInterruptible = {
  id: 'jobs-interruptible',
  title: 'Jobs should be interruptible',
  description:
    'Set "interruptible: true" on the job to avoid redundant job executions. Refer to https://docs.gitlab.com/ee/ci/yaml/#interruptible for details.',
  severity: 'warn',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0 && !allKeywords.has(key)) {
      if (key.startsWith('.')) {
        return undefined;
      }
      if (!Object.hasOwn(obj, 'interruptible')) {
        const full = resolver();
        if (full && Object.hasOwn(full, 'interruptible')) {
          // the interruptible property is inherited through an anchor
          return undefined;
        }
        return {
          message: `"${key}" job is not interruptible.`,
          fix: () => {
            node.value.items.unshift(doc.createPair('interruptible', true));
          },
        };
      }
    }
  },
};

// rather sad that setting global pipeline timeouts don't
// work, see this five(!) year old bug: https://gitlab.com/gitlab-org/gitlab/-/issues/213634
const jobsShouldHaveTimeout = {
  id: 'jobs-timeout',
  title: 'Jobs should have timeouts',
  description:
    'Set "timeout: <value>" on the job to avoid excessive default times. \
  Check what is a reasonable/expected time for the job to run and set a value in \
  that range. This avoids hogging runner capacity in hanger situations; imagine a \
  job that usually runs for five minutes, but that hangs for some reason. If the \
  default value is used (e.g. 1h), then runner capacity is unnecessarily blocked. \
  Refer to https://docs.gitlab.com/ee/ci/yaml/#timeout for details.',
  severity: 'warn',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0 && !allKeywords.has(key)) {
      if (key.startsWith('.')) {
        return undefined;
      }
      if (!Object.hasOwn(obj, 'timeout')) {
        const full = resolver();
        if (full && Object.hasOwn(full, 'timeout')) {
          // the interruptible property is inherited through an anchor
          return undefined;
        }
        return {
          message: `"${key}" job has not timeout set.`,
          fix: () => {
            node.value.items.unshift(doc.createPair('timeout', '10 minutes'));
          },
        };
      }
    }
  },
};

export const jobRules = [jobsShouldBeInterruptible, jobsShouldHaveTimeout];
