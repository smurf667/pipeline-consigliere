const exampleWorkflow = {
  rules: [
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
    { if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS', when: 'never' },
    { if: '$CI_COMMIT_BRANCH' },
  ],
};
const workflowAfter = new Set(['variables', 'stages']);
const defaultAfter = new Set(['variables', 'workflow', 'stages']);

const pipelineShowHaveWorkflow = {
  id: 'pipeline-workflow',
  title: 'Pipelines should have a workflow definition',
  description:
    'Refer to https://docs.gitlab.com/ee/ci/yaml/#workflow for details.',
  severity: 'info',
  rule: (key, _, depth) => {
    if (depth === 0 && key === 'workflow') {
      pipelineShowHaveWorkflow.hasWorkflow = true;
    }
  },
  finally: async (doc, subdocs) => {
    if (!pipelineShowHaveWorkflow.hasWorkflow) {
      // the pipeline has now workflow define, but an included
      // file might have; check for top-level 'workdflow' in
      // all included documents
      if (
        subdocs.findIndex((included) =>
          Object.hasOwn(included.toJSON(), 'workflow'),
        ) >= 0
      ) {
        return;
      }
      return {
        message: 'The pipeline should define a workflow.',
        fix: () => {
          const workflow = doc.createPair('workflow', exampleWorkflow);
          workflow.key.spaceBefore = true;
          const pos =
            doc.contents.items.findLastIndex((pair) =>
              workflowAfter.has(pair.key.value),
            ) + 1;
          if (pos > 0) {
            doc.contents.items.splice(pos, 0, workflow);
          } else {
            doc.contents.items.push(workflow);
          }
        },
      };
    }
  },
};

const workflowsShouldHaveAutoCancel = {
  id: 'workflows-have-autocancel',
  title: 'Workflows should have an auto-cancel setting',
  description:
    'When using workflows, consider aggressive auto-cancel settings to prevent unnecessary job executions. Refer to https://docs.gitlab.com/ee/ci/yaml/#workflowauto_cancelon_new_commit for details.',
  severity: 'info',
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0) {
      if (key === 'workflow') {
        if (!Object.hasOwn(obj, 'auto_cancel')) {
          const full = resolver();
          if (full && Object.hasOwn(full, 'auto_cancel')) {
            // the rules property is present in the fully built pipeline instructions
            return undefined;
          }
          return {
            message: 'workflow definition has no auto_cancel set.',
            fix: () =>
              node.value.items.unshift(
                doc.createPair('auto_cancel', {
                  on_new_commit: 'interruptible',
                }),
              ),
          };
        }
      }
    }
  },
};

const deprecatedKeywords = new Set([
  'image',
  'services',
  'cache',
  'before_script',
  'after_script',
]);

const findAliases = (node) => {
  const result = [];
  for (const key in node) {
    if (Object.hasOwn(node, key)) {
      if (key === 'source') {
        result.push(node[key]);
      } else {
        const child = node[key];
        if (typeof child === 'object') {
          (Array.isArray(child) ? child : [child]).forEach((c) =>
            findAliases(c).forEach((alias) => result.push(alias)),
          );
        }
      }
    }
  }
  return result;
};

const deprecatedGlobalKeywords = {
  id: 'pipeline-deprecated-globals',
  title: 'Pipeline uses deprecated global keywords',
  description:
    'Refer to https://docs.gitlab.com/ee/ci/yaml/#deprecated-keywords for details.',
  severity: 'warn',
  rule: (key, _, depth, __, node) => {
    if (depth === 0 && node.value.anchor) {
      if (!deprecatedGlobalKeywords.anchorMap) {
        deprecatedGlobalKeywords.anchorMap = {};
      }
      deprecatedGlobalKeywords.anchorMap[node.value.anchor] = key;
    }
    if (depth === 0 && deprecatedKeywords.has(key)) {
      if (!deprecatedGlobalKeywords.deprecatedNodes) {
        deprecatedGlobalKeywords.deprecatedNodes = [];
      }
      deprecatedGlobalKeywords.deprecatedNodes.push(node);
      return {
        message: `Top-level '${key}' is deprecated and should be moved under 'default'.`,
      };
    }
  },
  finally: async (doc) => {
    if (deprecatedGlobalKeywords.deprecatedNodes) {
      return {
        message: 'The pipeline uses deprecated top-level keywords.',
        fix: () => {
          for (const key of deprecatedKeywords) {
            doc.contents.delete(key);
          }
          const aliases = new Set();
          deprecatedGlobalKeywords.deprecatedNodes.forEach((node) =>
            findAliases(JSON.parse(JSON.stringify(node))).forEach((alias) =>
              aliases.add(alias),
            ),
          );
          let defaultNode = doc.contents.items.find(
            (pair) => pair.key.value === 'default',
          );
          if (!defaultNode) {
            defaultNode = doc.createPair(
              'default',
              deprecatedGlobalKeywords.deprecatedNodes.shift(),
            );
            defaultNode.key.spaceBefore = true;
            const pos =
              doc.contents.items.findLastIndex((pair) =>
                defaultAfter.has(pair.key.value),
              ) + 1;
            if (pos > 0) {
              doc.contents.items.splice(pos, 0, defaultNode);
            } else {
              doc.contents.items.unshift(defaultNode);
            }
          }
          for (const badNode of deprecatedGlobalKeywords.deprecatedNodes) {
            defaultNode.value.items.push(badNode);
          }
          // if aliases were used, move the anchor above 'default'
          // this only works for top-level anchors
          for (const alias of aliases) {
            const name = deprecatedGlobalKeywords.anchorMap[alias];
            if (name) {
              const anchorPos = doc.contents.items.findIndex(
                (pair) => pair.key.value == name,
              );
              const defaultPos = doc.contents.items.indexOf(defaultNode);
              if (anchorPos > defaultPos) {
                const anchor = doc.contents.items.splice(anchorPos, 1)[0];
                doc.contents.items.splice(defaultPos, 0, anchor);
              }
            }
          }
        },
      };
    }
  },
};

export const pipelineRules = [
  pipelineShowHaveWorkflow,
  workflowsShouldHaveAutoCancel,
  deprecatedGlobalKeywords,
];
