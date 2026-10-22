import { useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { CLERK_CASES, CLERK_DECISIONS, CLERK_REASONS, isCorrectClerkReview, type ClerkDecision, type ClerkReasonId } from '../game/clerk'

interface RecordedReview {
  readonly caseId: string
  readonly decision: ClerkDecision
  readonly reason: ClerkReasonId
  readonly correct: boolean
}

interface ClerkDeskProps {
  reduceMotion: boolean
  onExit: () => void
}

function witnessStatus(witness: 'none' | 'valid' | 'invalid') {
  if (witness === 'valid') return 'Witnessed while readable'
  if (witness === 'invalid') return 'Witnessed after redaction'
  return 'Not witnessed'
}

export default function ClerkDesk({ reduceMotion, onExit }: ClerkDeskProps) {
  const [caseIndex, setCaseIndex] = useState(0)
  const [decision, setDecision] = useState<ClerkDecision | ''>('')
  const [reason, setReason] = useState<ClerkReasonId | ''>('')
  const [submission, setSubmission] = useState<RecordedReview | null>(null)
  const [records, setRecords] = useState<RecordedReview[]>([])
  const [summary, setSummary] = useState(false)
  const submitted = useRef(false)
  const caseHeading = useRef<HTMLHeadingElement>(null)
  const summaryHeading = useRef<HTMLHeadingElement>(null)
  const nextFile = useRef<HTMLButtonElement>(null)
  const clerkCase = CLERK_CASES[caseIndex]

  useLayoutEffect(() => {
    if (summary) summaryHeading.current?.focus()
    else if (submission) nextFile.current?.focus()
    else caseHeading.current?.focus()
  }, [caseIndex, submission, summary])

  const recordDecision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!clerkCase || !decision || !reason || submitted.current) return
    submitted.current = true
    const record = {
      caseId: clerkCase.id,
      decision,
      reason,
      correct: isCorrectClerkReview(clerkCase.id, decision, reason),
    }
    setSubmission(record)
    setRecords((previous) => [...previous, record])
  }

  const advance = () => {
    if (!submission) return
    if (caseIndex === CLERK_CASES.length - 1) {
      setSubmission(null)
      setSummary(true)
      return
    }
    submitted.current = false
    setDecision('')
    setReason('')
    setSubmission(null)
    setCaseIndex((current) => current + 1)
  }

  const restart = () => {
    submitted.current = false
    setCaseIndex(0)
    setDecision('')
    setReason('')
    setSubmission(null)
    setRecords([])
    setSummary(false)
  }

  const decisionName = (value: ClerkDecision) => CLERK_DECISIONS[value]
  const reasonName = (value: ClerkReasonId) => CLERK_REASONS.find((item) => item.id === value)?.label ?? 'Unknown reason'

  return (
    <section className={`start-card clerk-desk ${reduceMotion ? 'reduce-motion' : ''}`} id="acting-clerk" aria-labelledby="clerk-title">
      <p className="micro">POST-VERDICT TRAINING</p>
      <h1 id="clerk-title" tabIndex={-1}>Acting Clerk</h1>
      <p className="clerk-notice">Training only. Your verdict and best score do not change.</p>
      <p className="clerk-reset-note">Training progress resets when you leave. No training result is saved.</p>
      <button className="clerk-exit" type="button" onClick={onExit}>Back to verdict</button>

      <div className="clerk-rules" aria-label="Filing rules">
        <h2>Reference rules</h2>
        <ul>
          <li>Witness while the Original is readable.</li>
          <li>A Copy captures readability and certification at the moment it is made.</li>
          <li>The Original must be redacted before filing.</li>
        </ul>
      </div>

      <div className="clerk-surface">
        {!summary && clerkCase && (
          <>
            <p className="clerk-progress">{clerkCase.label} of 3</p>
            <h2 ref={caseHeading} tabIndex={-1} className="clerk-case-heading">{clerkCase.label}: {clerkCase.applicant}</h2>
            <p className="clerk-fiction">{clerkCase.statement}</p>

            <section className="clerk-document" aria-label={`${clerkCase.label} submitted record`}>
              <h3>Submitted record</h3>
              <h4>Action history</h4>
              <ol className="clerk-history">
                {clerkCase.sequence.map((action, index) => <li key={`${clerkCase.id}-${action}`}>{index + 1}. {action[0].toUpperCase()}{action.slice(1)}</li>)}
              </ol>
              <dl className="clerk-evidence">
                <div><dt>Original readability</dt><dd>{clerkCase.evaluation.originalReadable ? 'Readable' : 'Redacted and unreadable'}</dd></div>
                <div><dt>Witness</dt><dd>{witnessStatus(clerkCase.evaluation.witness)}</dd></div>
                <div><dt>Copy present</dt><dd>{clerkCase.evaluation.copyPresent ? 'Present' : 'Not present'}</dd></div>
                <div><dt>Copy readability</dt><dd>{clerkCase.evaluation.copyReadable ? 'Readable' : 'Unreadable'}</dd></div>
                <div><dt>Copy certification</dt><dd>{clerkCase.evaluation.copyCertified ? 'Certified' : 'Not certified'}</dd></div>
              </dl>
            </section>

            <form className="clerk-form" onSubmit={recordDecision}>
              <fieldset className="clerk-options">
                <legend>Decision</legend>
                {(['accept', 'return'] as const).map((value) => (
                  <label className="clerk-option" key={value} htmlFor={`${clerkCase.id}-decision-${value}`}>
                    <input
                      id={`${clerkCase.id}-decision-${value}`}
                      type="radio"
                      name={`${clerkCase.id}-decision`}
                      value={value}
                      checked={decision === value}
                      disabled={Boolean(submission)}
                      onChange={() => setDecision(value)}
                    />
                    <span>{decisionName(value)}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="clerk-options">
                <legend>Reason</legend>
                {CLERK_REASONS.map((option) => (
                  <label className="clerk-option" key={option.id} htmlFor={`${clerkCase.id}-reason-${option.id}`}>
                    <input
                      id={`${clerkCase.id}-reason-${option.id}`}
                      type="radio"
                      name={`${clerkCase.id}-reason`}
                      value={option.id}
                      checked={reason === option.id}
                      disabled={Boolean(submission)}
                      onChange={() => setReason(option.id)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              {!decision || !reason ? <p className="clerk-hint">Choose both a decision and a reason before recording this file.</p> : null}
              {!submission && <button className="primary" type="submit" disabled={!decision || !reason}>Record decision</button>}
            </form>
          </>
        )}

        <div className="clerk-feedback" role="status" aria-live="polite" aria-atomic="true" data-clerk-announcer>
          {!summary && submission && clerkCase && (
            <>
              <h3>{submission.correct ? 'Correct review' : 'Review corrected'}</h3>
              <p>{clerkCase.label}: review recorded.</p>
              <p>Required decision: <strong>{decisionName(clerkCase.correctDecision)}</strong></p>
              <p>Required reason: <strong>{reasonName(clerkCase.correctReason)}</strong></p>
              <p>{clerkCase.explanation}</p>
            </>
          )}
        </div>
        {!summary && submission && <button ref={nextFile} className="primary" type="button" onClick={advance}>{caseIndex === CLERK_CASES.length - 1 ? 'Finish shift' : 'Next file'}</button>}

        {summary && (
          <section className="clerk-summary" aria-labelledby="clerk-summary-title">
            <p className="clerk-progress">Shift summary</p>
            <h2 ref={summaryHeading} id="clerk-summary-title" tabIndex={-1}>Training complete</h2>
            <p className="clerk-count">Reviews correct: {records.filter((record) => record.correct).length}/3</p>
            <ol className="clerk-summary-list">
              {CLERK_CASES.map((item) => {
                const record = records.find((entry) => entry.caseId === item.id)
                return (
                  <li key={item.id}>
                    <h3>{item.label}: {item.applicant}</h3>
                    <p>Your review: <strong>{record?.correct ? 'Correct' : 'Needs correction'}</strong></p>
                    <p>Required decision: {decisionName(item.correctDecision)}. Your decision: {record ? decisionName(record.decision) : 'Not recorded'}.</p>
                    <p>Required reason: {reasonName(item.correctReason)} Your reason: {record ? reasonName(record.reason) : 'Not recorded'}</p>
                  </li>
                )
              })}
            </ol>
            <div className="clerk-summary-actions">
              <button className="primary" type="button" onClick={restart}>Review files again</button>
              <button type="button" onClick={onExit}>Back to verdict</button>
            </div>
          </section>
        )}
      </div>
    </section>
  )
}
