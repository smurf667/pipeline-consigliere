const exampleWorkflow = {
  rules: [
    { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
    { if: '$CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS', when: 'never' },
    { if: '$CI_COMMIT_BRANCH' },
  ],
};
const workflowAfter = new Set(['variables', 'image', 'stages']);

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
  finally: (doc, subdocs) => {
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

export const pipelineRules = [pipelineShowHaveWorkflow];
