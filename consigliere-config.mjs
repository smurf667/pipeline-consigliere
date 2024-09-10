const jobNamesMustBeInKebabCase = {
  id: 'example-kebab-case',
  title: 'Job names must be in kebab-case',
  description:
    'Example rule that flags job names that are not in kebab-case as an error.',
  severity: 'error',
  // called for each key visited
  rule: (key, obj, depth, resolver, node, doc) => {
    if (depth === 0) {
      // this will also check https://docs.gitlab.com/ee/ci/yaml/#global-keywords
      // but these are alreay in kebab-case, so all good
      if (!key.startsWith('.') && key.match(/[A-Z_]/)) {
        const kebab = key
          .replace(/([a-z_])([A-Z])/g, '$1-$2')
          .replace(/[\s_]+/g, '-')
          .toLowerCase();
        jobNamesMustBeInKebabCase.badCount++;
        return {
          message: `Job name "${key}" should be in kebab-case: "${kebab}"`,
          fix: () => (node.key.value = kebab),
        };
      }
    }
    if (depth > 1000) {
      console.log('explanation of args', {
        key, // the name of the YAML property
        obj, // the JavaScript representation parsed from the YAML file for the property
        depth, // the nesting depth of the property (zero-based)
        resolver, // a function that can resolve the JavaScript object fully, including anchor references and 'extends' returns undefined if resolution not required
        node, // the current node
        doc, // the full YAML document
      });
    }
  },
  // called after a document was processed, this could for example be
  // used to check for the absence of keys; see pipelineRules.mjs for the 'workflow' check
  finally: async (doc, subdocs) => {
    console.log();
    console.log(
      jobNamesMustBeInKebabCase.id,
      `There were ${jobNamesMustBeInKebabCase.badCount} badly named jobs.`,
    );
    if (jobNamesMustBeInKebabCase.badCount > 1000) {
      console.log('explanation of args', {
        doc, // the document that was analyzed
        subdocs, // a list of included documents
      });
    }
  },
};
jobNamesMustBeInKebabCase.badCount = 0;

export default (config) => {
  config.rules.push(jobNamesMustBeInKebabCase);
  return config;
};
