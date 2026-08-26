import type { WorkflowDefinition } from '../types.ts'

export const researchReportKnowledgeIngestionWorkflowDefinition: WorkflowDefinition = {
  id: 'research-report-knowledge-ingestion',
  name: 'Research Report Knowledge Ingestion',
  description: 'Resolve, curate, validate, and optionally commit a research report into an explicitly selected Knowledge Base.',
  version: '0.1',
  purpose: 'Provide a deterministic Workflow composition over Raw Archive, Knowledge Access, Curation, Validation, and Writer interfaces.',
  inputSchema: {
    workflowRunId: { type: 'string', required: true, description: 'Path-safe Workflow run identifier.' },
    knowledgeBaseId: { type: 'string', required: true, description: 'Explicit target Knowledge Base identifier.' },
    report: { type: 'object', required: true, description: 'Research report input reference and supplied metadata.' },
    options: { type: 'object', required: true, description: 'Commit/dry-run and reprocess controls.' },
  },
  outputSchema: {
    status: { type: 'string', required: true, description: 'Completed, completed_with_review, or blocked.' },
    raw: { type: 'object', required: true, description: 'Raw identity and persistence summary.' },
    source: { type: 'object', required: true, description: 'Source assessment and canonical source identity.' },
    candidates: { type: 'object', required: true, description: 'Candidate processing counters.' },
    changes: { type: 'object', required: true, description: 'Durable write counters.' },
    validation: { type: 'object', required: false, description: 'Validation report when planning is performed.' },
  },
  steps: [
    { id: 'intake-target-resolution', skill: 'knowledge-base-runtime', inputs: ['knowledgeBaseId'], outputs: ['target'], dependsOn: [] },
    { id: 'raw-archive-normalization', skill: 'knowledge-raw-archive', inputs: ['report.inputRef', 'report.suppliedMetadata'], outputs: ['rawRef', 'normalizedDocument'], dependsOn: ['intake-target-resolution'] },
    { id: 'source-assessment', skill: 'knowledge-curation', inputs: ['normalizedDocument', 'target'], outputs: ['sourceAssessment'], dependsOn: ['raw-archive-normalization'] },
    { id: 'content-filtering', skill: 'knowledge-curation', inputs: ['normalizedDocument', 'sourceAssessment', 'target'], outputs: ['relevance'], dependsOn: ['source-assessment'] },
    { id: 'candidate-extraction-admission', skill: 'knowledge-curation', inputs: ['relevance', 'sourceAssessment', 'target'], outputs: ['candidates', 'admissions'], dependsOn: ['content-filtering'] },
    { id: 'schema-mapping-gaps', skill: 'knowledge-curation', inputs: ['candidates', 'target'], outputs: ['mappings', 'schemaGaps'], dependsOn: ['candidate-extraction-admission'] },
    { id: 'existing-knowledge-retrieval', skill: 'knowledge-access', inputs: ['mappings', 'target'], outputs: ['existingKnowledge'], dependsOn: ['schema-mapping-gaps'] },
    { id: 'conflict-resolution', skill: 'knowledge-curation', inputs: ['mappings', 'existingKnowledge'], outputs: ['resolvedCandidates', 'conflicts'], dependsOn: ['existing-knowledge-retrieval'] },
    { id: 'changeset-planning', skill: 'knowledge-writer', inputs: ['resolvedCandidates', 'conflicts'], outputs: ['changeSet'], dependsOn: ['conflict-resolution'] },
    { id: 'validation-and-knowledge-commit', skill: 'knowledge-validation', inputs: ['changeSet'], outputs: ['validationReport', 'writeResult'], dependsOn: ['changeset-planning'] },
    { id: 'final-provenance-review-output', skill: 'research-report-knowledge-ingestion', inputs: ['writeResult', 'validationReport'], outputs: ['ingestionResult'], dependsOn: ['validation-and-knowledge-commit'] },
  ],
}
