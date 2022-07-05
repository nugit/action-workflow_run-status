import * as core from '@actions/core'
import * as github from '@actions/github'
import * as stateHelper from './state-helper'
import {wait} from './wait'

type Status = 'failure' | 'pending' | 'success'

async function run(): Promise<void> {
  try {
    await postStatus(false)
  } catch (error) {
    core.setFailed(error.message)
  }
}

async function cleanup(): Promise<void> {
  try {
    await postStatus(true)
  } catch (error) {
    core.warning(error.message)
  }
}

function job2status(
  job: {
    id: number
    run_id: number
    node_id: string
    head_sha: string
    url: string
    html_url: string
    status: string
    conclusion: string
    started_at: string
    completed_at: string
    name: string
    steps: {
      name: string
      status: string
      conclusion: string
      number: number
      started_at: string
      completed_at: string
    }[]
    check_run_url: string
  },
  isCleanUp: boolean
): Status {
  if (!isCleanUp) {
    return 'pending'
  }
  // Find step with failure instead of relying on job.conclusion because this
  // (post) action itself is one of a step of this job and job.conclusion is
  // always null while running this action.
  const failedStep = job.steps.find(step => step.conclusion === 'failure')
  if (failedStep) {
    return 'failure'
  }
  return 'success'
}

async function postStatus(isCleanUp: boolean): Promise<void> {
  const context = github.context

  if (core.isDebug()) {
    core.startGroup('github.context:')
    core.debug(JSON.stringify(context, null, 2))
    core.endGroup()
  }

  if (context.eventName !== 'workflow_run') {
    throw new Error(
      `This is not workflow_run event: eventName=${context.eventName}`
    )
  }
  const token = core.getInput('github_token')
  const jobId = core.getInput('job_id')
  const octokit = github.getOctokit(token)
  if (isCleanUp) {
    core.info(
      'Waiting 10 secs to wait for other steps job completion are propagated to GitHub API response.'
    )
    await wait(10 * 1000)
  }
  const jobs = await octokit.actions.listJobsForWorkflowRun({
    owner: context.repo.owner,
    repo: context.repo.repo,
    run_id: context.runId,
    filter: 'latest',
    per_page: 100
  })

  if (core.isDebug()) {
    core.startGroup('jobs:')
    core.debug(JSON.stringify(jobs, null, 2))
    core.endGroup()
  }

  const job = jobs.data.jobs.find(j => j.name === jobId)
  if (!job) {
    throw new Error(`job not found: ${jobId}`)
  }
  const state =
    context.payload.action === 'requested' && requestedAsPending()
      ? 'pending'
      : job2status(job, isCleanUp)
  const resp = await octokit.repos.createCommitStatus({
    owner: context.repo.owner,
    repo: context.repo.repo,
    sha: context.payload.workflow_run.head_commit.id,
    state,
    context: `${context.workflow} / ${jobId} (${context.payload.workflow_run.event} => ${context.eventName})`,
    target_url: job.html_url
  })
  core.debug(JSON.stringify(resp, null, 2))
}

function requestedAsPending(): boolean {
  return (
    (core.getInput('requested_as_pending') || 'false').toUpperCase() === 'TRUE'
  )
}

// Main
if (!stateHelper.IsPost) {
  run()
}
// Post
else {
  cleanup()
}
