import { allKeywords } from './constants.mjs';

const jobsShouldBeInterruptible = {
  id: 'jobs-interruptible',
  title: 'Jobs should be interruptible',
  description:
    'Set "interruptible: true" on the job to avoid redundant job executions. Refer to https://docs.gitlab.com/ee/ci/yaml/#interruptible for details.',
  severity: 'warn',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (jobsShouldBeInterruptible.hasDefaultInterruptible) {
      return;
    }
    if (depth === 0 && key === 'default') {
      if (Object.hasOwn(obj, 'interruptible')) {
        jobsShouldBeInterruptible.hasDefaultInterruptible = true;
      }
      return;
    }
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
            if (jobsShouldBeInterruptible.hasDefaultInterruptible) {
              return;
            }
            let defaultNode = doc.contents.items.find(
              (pair) => pair.key.value === 'default',
            );
            if (!defaultNode) {
              defaultNode = doc.createPair('default', {
                interruptible: true,
              });
              defaultNode.key.spaceBefore = true;
              const pos =
                doc.contents.items.findLastIndex(
                  (pair) => pair.key.value === 'variables',
                ) + 1;
              if (pos > 0) {
                doc.contents.items.splice(pos, 0, defaultNode);
              } else {
                doc.contents.items.push(defaultNode);
              }
            } else {
              defaultNode.value.items.unshift(
                doc.createPair('interruptible', true),
              );
            }
            jobsShouldBeInterruptible.hasDefaultInterruptible = true;
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
        if (
          full &&
          (Object.hasOwn(full, 'timeout') || Object.hasOwn(full, 'trigger'))
        ) {
          // the interruptible property is inherited through an anchor
          // or the job uses a trigger, in which case timeout cannot be set
          return undefined;
        }
        return {
          message: `"${key}" job has not timeout set.`,
          fix: () =>
            node.value.items.unshift(doc.createPair('timeout', '10 minutes')),
        };
      }
    }
  },
};

const jobsShouldHaveRules = {
  id: 'jobs-have-rules',
  title: 'Jobs should have rules',
  description:
    'Add a "rules" section to the job to define when it needs to run. Without rules it may be run unconditionally. Refer to https://docs.gitlab.com/ee/ci/yaml/#rules for details.',
  severity: 'info',
  rule: (key, obj, depth, resolver) => {
    if (depth === 0) {
      if (!allKeywords.has(key)) {
        if (key.startsWith('.')) {
          return undefined;
        }
        if (!Object.hasOwn(obj, 'rules')) {
          const full = resolver();
          if (full && Object.hasOwn(full, 'rules')) {
            // the rules property is inherited through an anchor
            return undefined;
          }
          if (jobsShouldHaveRules.hasWorkflowRules) {
            return undefined;
          }
          return {
            message: `"${key}" job has no rules set.`,
          };
        }
      } else if (key === 'workflow') {
        jobsShouldHaveRules.hasWorkflowRules = Object.hasOwn(obj, 'rules');
      }
    }
  },
};

const jobsArtifactsShouldExpire = {
  id: 'jobs-artifacts-expire',
  title: 'Job artifacts should expire',
  description:
    'Set "expire_in: <value>" on job artifacts to avoid consuming storage unnecessarily. \
    Refer to https://docs.gitlab.com/ee/ci/yaml/#artifactsexpire_in for details.',
  severity: 'warn',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0) {
      if (!allKeywords.has(key)) {
        if (key.startsWith('.')) {
          return undefined;
        }
        if (Object.hasOwn(obj, 'artifacts')) {
          if (obj.artifacts.expire_in) {
            return undefined;
          }
          const full = resolver();
          if (full && Object.hasOwn(full.artifacts, 'expire_in')) {
            // the expire_in property of artifacts is inherited
            return undefined;
          }
          return {
            message: `"${key}" job has artifacts, but does not set expire_in for them.`,
            fix: () => {
              const artifacts = node.value.items.find(
                (pair) => pair.key.value === 'artifacts',
              );
              artifacts.value.items.unshift(
                doc.createPair('expire_in', '12 hours'),
              );
            },
          };
        }
      }
    }
  },
};

const redundantNeverRule = {
  id: 'redundant-never-rule',
  title: 'The last "when: never" rule is redundant',
  description:
    'The "rules:" block has a redundant "when: never" rule. See https://stackoverflow.com/q/74868716/1134748',
  severity: 'warn',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0) {
      if (!allKeywords.has(key)) {
        if (key.startsWith('.')) {
          return undefined;
        }
        if (Object.hasOwn(obj, 'rules')) {
          const last = obj.rules.slice(-1).pop();
          if (Object.hasOwn(last, 'when') && last.when === 'never') {
            return {
              message: `"${key}" job has a redundant "when: never" rule.`,
              fix: () => {
                const rules = node.value.items.find(
                  (pair) => pair.key.value === 'rules',
                );
                rules.value.items.pop();
              },
            };
          }
        }
        return undefined;
      }
    }
  },
}

export const jobRules = [
  jobsArtifactsShouldExpire,
  jobsShouldBeInterruptible,
  jobsShouldHaveRules,
  jobsShouldHaveTimeout,
  redundantNeverRule,
];
