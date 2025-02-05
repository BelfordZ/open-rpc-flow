import simple from './01-simple-request.json';
import dataTransform from './02-data-transformation.json';
import nestedLoops from './03-nested-loops.json';
import conditionalBranching from './04-conditional-branching.json';
import complexDataPipeline from './05-complex-data-pipeline.json';
import { Flow } from '../types';

// Assert the type of each imported JSON
const simpleFlow = simple as Flow;
const dataTransformFlow = dataTransform as Flow;
const nestedLoopsFlow = nestedLoops as Flow;
const conditionalBranchingFlow = conditionalBranching as Flow;
const complexDataPipelineFlow = complexDataPipeline as Flow;

// Export with unique names
export {
    simpleFlow,
    dataTransformFlow,
    nestedLoopsFlow,
    conditionalBranchingFlow,
    complexDataPipelineFlow
};

// Export the array of examples with proper typing
export const examples: Flow[] = [
    simpleFlow,
    dataTransformFlow,
    nestedLoopsFlow,
    conditionalBranchingFlow,
    complexDataPipelineFlow
];
