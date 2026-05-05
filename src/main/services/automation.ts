import { nanoid } from 'nanoid'
import type { ProfileRecord } from '@shared/types'
import { enqueueCommand, type AutomationCommand, type AutomationProgress } from './mail-server'
import { isRunning, launchProfile } from './profile-launcher'

const GMAIL_URL = 'https://mail.google.com/'

export interface GmailRotateOptions {
  maxItems?: number
  minOpenMs?: number
  maxOpenMs?: number
  minReadMs?: number
  maxReadMs?: number
}

export interface GmailRunResult {
  profileId: string
  commandId: string
  launched: boolean
  pid?: number
  error?: string
  warning?: string
}

/**
 * Queue a Gmail rotate-unread automation command for a profile.
 *
 * If the profile is not running, launches it with `mail.google.com` as the start
 * URL so the gmail-watcher content script will pick up the command on load.
 * If already running, the user is expected to have a `mail.google.com` tab open
 * in that profile (the content script polls for commands every few seconds).
 */
export async function runGmailRotateForProfile(
  profile: ProfileRecord,
  options: GmailRotateOptions = {},
): Promise<GmailRunResult> {
  const command: AutomationCommand = {
    id: nanoid(10),
    type: 'gmail-rotate-unread',
    profileId: profile.id,
    options,
    createdAt: Date.now(),
  }

  // Enqueue first so that if launch is fast and content script polls
  // immediately, the command is already there.
  enqueueCommand(profile.id, command)

  if (isRunning(profile.id)) {
    return { profileId: profile.id, commandId: command.id, launched: false }
  }

  try {
    const result = await launchProfile(profile, { startUrlOverride: GMAIL_URL })
    return {
      profileId: profile.id,
      commandId: command.id,
      launched: true,
      pid: result.pid,
      warning: result.warning,
    }
  } catch (e) {
    return {
      profileId: profile.id,
      commandId: command.id,
      launched: false,
      error: (e as Error).message,
    }
  }
}

export type AutomationProgressEvent = AutomationProgress
