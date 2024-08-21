# Pipeline Consigiliere

> [!CAUTION]
> I consider this a prototype that may have to be improved for enterprise use.

[![consigliere image generated with ChatGPT](./images/consigliere_small.png)](./images/consigliere.png)

You may be the godfather of your pipelines, but you should listen to your consigiliere!
Jokes aside, this is a rules-based linter for [GitLab](https://about.gitlab.com/) pipelines to make them follow best practices.

The primary goal is to ensure pipelines are eco-friendly, i.e. to configure them such that
they do not consume resources unnecessarily. There are many ways to achieve this, and the
rules can only be opinionated. They are meant as hints on what to improve; it's not like
it is making you an offer you cannot refuse!

## Running

If the tool is present in your npm registry, it can simply be run in a project root via

	npx pipeline-consigliere

To see all options, run

	npx pipeline-consigliere --help

When installed, the tool can be run without the `npx` prefix.

## Building

To build the tool run

	npm install
	npm pack

It can be installed globally with

	npm install -g pipeline-consigliere*.tgz

### Limitations

It is difficult to replicate how GitLab parses and processes a full pipeline, especially
with the use of `include` and `extends` keywords.
Note that `include` statements are currently not fully resolved, and some may require
additional environment variables, such as:

- `CI_API_V4_URL` - the GitLab API base path
- `ACCESS_TOKEN` - a token which allows reading files from repositories

When applying fixes, the input YAML file gets reformatted, but it will remain valid YAML.

## Existing rules

Built-in job rules are located in [`lib/jobRules.mjs`](./lib/jobRules.mjs).
There are currently these rules:

- `jobs-interruptible` - Jobs should be interruptible
- `jobs-timeout` - Jobs should have timeouts (unfortunately, because of this [bug](https://gitlab.com/gitlab-org/gitlab/-/issues/213634))
- `jobs-have-rules` - Jobs should have rules

Built-in pipeline-level rules are located in [`lib/pipelineRules.mjs`](./lib/pipelineRules.mjs).
There are currently these rules:

- `pipeline-workflow` - Pipelines should have a workflow definition

## Customizing rules

The tool ships with the above set of rules. These can be modified or amended by using a
file called `consigliere-config.mjs` in the project root:

```javascript
export default (config) => {
  // just return
  return config;
};
```

This custom configuration file can be used to change the severity of rules, or to add or remove some.
For example, this would change all severities to `info`:

```javascript
export default (config) => {
  config.rules.forEach(rule => rule.severity = 'info');
  return config;
};
```

Refer to [`consigliere-config.mjs`](./consigliere-config.mjs) for an example of a custom rule ("job names should be in kebab-case").

## Testing and development

Run

	npm run test

to perform tests. These tests are located in [`test/pipelines`](./test/pipelines) and follow this pattern:

1. `<name>.yml` - the pipeline definition to test
2. `<name>.json` - a JSON file with expected changes when processed
3. `<name>.expected` - the literal pipeline YAML that is expected after modifications

The sources can be linted or prettified with respective commands:

	npm run lint
	npm run prettier # to check
	npm run prettify # to prettify
