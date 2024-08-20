import { jobRules } from './jobRules.mjs';
import { pipelineRules } from './pipelineRules.mjs';

export default {
  rules: [...jobRules, ...pipelineRules],
};
