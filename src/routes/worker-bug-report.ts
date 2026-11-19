import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import {
  BUG_REPORT_TAGS,
  createBugReport,
  isValidBugReportTag,
  type BugReportRecord,
} from '../services/bug-reports.js';
import { getMachineById, type MachineRecord } from '../services/machines.js';
import {
  escapeHtml,
  renderErrorCodeBadge,
  renderPortalLayout,
  renderStatusBadge,
  renderUnknownMachinePage,
} from '../ui/portal-layout.js';

interface MachineParams {
  machineId: string;
}

const REPORT_BUG_STYLES = `
@layer components {
  .bug-report-form {
    display: flex;
    flex-direction: column;
    gap: 1.15rem;
    accent-color: var(--accent-primary);
  }

  .tag-fieldset {
    border: 2px solid var(--border);
    border-radius: 0.75rem;
    padding: 1rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-inline-size: 0;
  }

  .tag-fieldset legend {
    font-weight: 700;
    font-size: 1.05rem;
    padding-inline: 0.35rem;
  }

  .tag-fieldset:has(input[type="radio"]:user-invalid),
  .tag-fieldset[data-invalid="true"] {
    border-color: var(--error-border);
    background-color: var(--error-bg);
  }

  .tag-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .tag-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-block-size: var(--target-min);
    min-inline-size: var(--target-min);
    padding: 0.85rem 1rem;
    border: 2px solid var(--border);
    border-radius: 0.65rem;
    background-color: var(--surface);
    color: var(--text);
    font-weight: 600;
    font-size: 1.05rem;
    cursor: pointer;
  }

  .tag-card input[type="radio"] {
    inline-size: 1.35rem;
    block-size: 1.35rem;
    margin: 0;
    flex-shrink: 0;
    accent-color: var(--accent-primary);
  }

  .tag-card:has(input[type="radio"]:checked) {
    border-color: var(--accent-primary);
    background-color: var(--surface-subtle);
    font-weight: 700;
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  .tag-card:has(input[type="radio"]:focus-visible) {
    outline: 3px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-group > label {
    font-weight: 700;
    font-size: 1rem;
  }

  .field-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .note-textarea {
    font: inherit;
    font-size: max(1rem, 1em);
    inline-size: 100%;
    min-block-size: 6.5rem;
    padding: 0.75rem;
    border: 2px solid var(--border);
    border-radius: 0.65rem;
    background-color: var(--surface);
    color: var(--text);
    resize: vertical;
  }

  .note-textarea:user-invalid {
    border-color: var(--error-border);
    background-color: var(--error-bg);
  }

  .field-error {
    margin: 0.25rem 0 0;
    padding: 0.65rem 0.8rem;
    border: 2px solid var(--error-border);
    border-radius: 0.5rem;
    background-color: var(--error-bg);
    color: var(--error-text);
    font-weight: 700;
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .field-error[hidden] {
    display: none;
  }

  .submit-button {
    font: inherit;
    font-size: max(1rem, 1em);
    font-weight: 700;
    inline-size: 100%;
    min-block-size: var(--target-min);
    padding: 0.9rem 1.25rem;
    border-radius: 0.65rem;
    border: 2px solid var(--accent-primary);
    background-color: var(--accent-primary);
    color: var(--accent-primary-text);
    cursor: pointer;
  }

  .submit-button:hover:not(:disabled) {
    background-color: var(--accent-primary-hover);
    border-color: var(--accent-primary-hover);
  }

  .submit-button:disabled {
    opacity: 0.75;
    cursor: wait;
  }

  .confirmation-card {
    border-color: var(--working-border);
  }

  .confirmation-banner {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.75rem 0.95rem;
    margin-block-end: 0.9rem;
    border-radius: 0.5rem;
    border: 2px solid var(--working-border);
    background-color: var(--working-bg);
    color: var(--working-text);
    font-weight: 700;
  }

  .confirmation-details {
    margin: 0 0 1rem;
    display: grid;
    grid-template-columns: 1fr;
    gap: 0.65rem;
  }

  .confirmation-row {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-block-end: 0.5rem;
    border-block-end: 1px solid var(--surface-subtle);
  }

  .confirmation-row dt {
    color: var(--text-muted);
    font-size: 0.88rem;
    font-weight: 600;
  }

  .confirmation-row dd {
    margin: 0;
    font-weight: 700;
  }

  .confirmation-note {
    white-space: pre-wrap;
    overflow-wrap: break-word;
  }

  @media (forced-colors: active) {
    .tag-fieldset,
    .tag-card,
    .note-textarea,
    .field-error,
    .submit-button,
    .confirmation-card,
    .confirmation-banner {
      border-color: CanvasText;
    }

    .tag-card:has(input[type="radio"]:checked) {
      border-color: Highlight;
      outline: 2px solid Highlight;
    }
  }
}
`;

const REPORT_BUG_SCRIPT = `(() => {
  const form = document.getElementById('bug-report-form');
  const fieldset = document.getElementById('tag-fieldset');
  const tagError = document.getElementById('tag-error');
  const submitButton = document.getElementById('submit-bug-report');
  if (!form || !fieldset || !tagError || !submitButton) return;

  const radios = Array.from(form.querySelectorAll('input[type="radio"][name="tag"]'));
  const defaultLabel = submitButton.textContent || 'Submit Bug Report';

  const setTagValidationState = (invalid, message) => {
    const ariaInvalid = invalid ? 'true' : 'false';
    fieldset.setAttribute('aria-invalid', ariaInvalid);
    if (invalid) {
      fieldset.dataset.invalid = 'true';
      fieldset.setAttribute('aria-describedby', 'tag-error');
      tagError.textContent = message || 'Please choose what happened before submitting.';
      tagError.hidden = false;
    } else {
      delete fieldset.dataset.invalid;
      fieldset.removeAttribute('aria-describedby');
      tagError.textContent = '';
      tagError.hidden = true;
    }
    for (const radio of radios) {
      radio.setAttribute('aria-invalid', ariaInvalid);
      if (invalid) {
        radio.setAttribute('aria-describedby', 'tag-error');
      } else {
        radio.removeAttribute('aria-describedby');
      }
    }
  };

  form.addEventListener('change', (event) => {
    const target = event.target;
    if (target instanceof Element && target.matches('input[name="tag"]')) {
      setTagValidationState(false);
    }
  });

  form.addEventListener(
    'invalid',
    (event) => {
      const target = event.target;
      if (target instanceof Element && target.matches('input[name="tag"]')) {
        setTagValidationState(true, 'Please choose what happened before submitting.');
      }
    },
    true,
  );

  form.addEventListener('submit', (event) => {
    if (form.dataset.submitted === 'true') {
      event.preventDefault();
      return;
    }

    const hasSelectedTag = radios.some((radio) => radio.checked);
    if (!hasSelectedTag || !form.checkValidity()) {
      event.preventDefault();
      setTagValidationState(true, 'Please choose what happened before submitting.');
      if (radios[0]) {
        radios[0].focus();
      }
      return;
    }

    form.dataset.submitted = 'true';
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
  });

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      delete form.dataset.submitted;
      submitButton.disabled = false;
      submitButton.textContent = defaultLabel;
    }
  });
})();`;

/**
 * Optional validation and preservation state when rendering or re-rendering the bug-report form.
 */
export interface BugReportFormState {
  selectedTag?: string;
  workerNote?: string;
  tagError?: string;
  noteError?: string;
}

/**
 * Render the mobile-first Report-a-Bug form HTML page for a registered machine.
 */
export function renderBugReportFormPage(
  machine: MachineRecord,
  state: BugReportFormState = {},
): string {
  const encodedId = encodeURIComponent(machine.id);
  const activeErrorHtml = machine.active_error
    ? renderErrorCodeBadge(machine.active_error)
    : '';
  const hasTagError = Boolean(state.tagError);
  const hasNoteError = Boolean(state.noteError);
  const workerNoteValue = state.workerNote ?? '';

  const fieldsetInvalidAttrs = hasTagError
    ? ' data-invalid="true" aria-invalid="true" aria-describedby="tag-error"'
    : ' aria-invalid="false"';
  const radioInvalidAttrs = hasTagError
    ? 'aria-invalid="true" aria-describedby="tag-error"'
    : 'aria-invalid="false"';
  const tagErrorHtml = hasTagError
    ? `<p id="tag-error" class="field-error" role="alert"><span role="img" aria-label="Error">&#9888;</span><span>${escapeHtml(state.tagError!)}</span></p>`
    : '<p id="tag-error" class="field-error" role="alert" hidden></p>';

  const noteDescribedBy = hasNoteError ? 'worker-note-hint note-error' : 'worker-note-hint';
  const noteAriaInvalid = hasNoteError ? 'true' : 'false';
  const noteErrorHtml = hasNoteError
    ? `<p id="note-error" class="field-error" role="alert"><span role="img" aria-label="Error">&#9888;</span><span>${escapeHtml(state.noteError!)}</span></p>`
    : '';

  const radioCardsHtml = BUG_REPORT_TAGS.map((tag, index) => {
    const inputId = `tag-${index}`;
    const escapedTag = escapeHtml(tag);
    const checkedAttr = state.selectedTag === tag ? ' checked' : '';
    return `<label class="tag-card" for="${inputId}">
      <input type="radio" id="${inputId}" name="tag" value="${escapedTag}" required ${radioInvalidAttrs}${checkedAttr}>
      <span class="tag-label-text">${escapedTag}</span>
    </label>`;
  }).join('\n');

  const bodyHtml = `
    <section class="card">
      <h1>Report a Bug</h1>
      <p class="machine-meta">${escapeHtml(machine.display_name)} &middot; ID: <code>${escapeHtml(machine.id)}</code></p>
      <div class="status-row">
        ${renderStatusBadge(machine.current_state)}
      </div>
      ${activeErrorHtml}
    </section>

    <section class="card">
      <form class="bug-report-form" id="bug-report-form" method="POST" action="/m/${escapeHtml(encodedId)}/report-bug">
        <fieldset class="tag-fieldset" id="tag-fieldset"${fieldsetInvalidAttrs}>
          <legend>What happened? (Required)</legend>
          <div class="tag-grid">
            ${radioCardsHtml}
          </div>
          ${tagErrorHtml}
        </fieldset>

        <div class="field-group">
          <label for="worker-note">Optional note</label>
          <p id="worker-note-hint" class="field-hint">Type details or use your Android keyboard microphone.</p>
          <textarea class="note-textarea" id="worker-note" name="worker_note" rows="4" aria-invalid="${noteAriaInvalid}" aria-describedby="${noteDescribedBy}">${escapeHtml(workerNoteValue)}</textarea>
          ${noteErrorHtml}
        </div>

        <button class="submit-button" id="submit-bug-report" type="submit">Submit Bug Report</button>
      </form>
    </section>
    <script>${REPORT_BUG_SCRIPT}</script>
  `;

  return renderPortalLayout({
    title: `Report a Bug · ${machine.display_name} (${machine.id}) | Winding Room Portal`,
    bodyHtml,
    backHref: `/m/${encodedId}`,
    backLabel: 'Back to Machine',
    extraStyles: REPORT_BUG_STYLES,
  });
}

/**
 * Render the 201 HTML confirmation screen after persisting a machine bug report.
 */
export function renderBugReportConfirmationPage(
  machine: MachineRecord,
  report: BugReportRecord,
): string {
  const encodedId = encodeURIComponent(machine.id);
  const snapshotCount = report.attached_logs_json.length;
  const snapshotLabel = `${snapshotCount} ${snapshotCount === 1 ? 'event' : 'events'}`;
  const errorRowHtml = report.error_code
    ? `<div class="confirmation-row">
         <dt>Captured error code</dt>
         <dd><code>${escapeHtml(report.error_code)}</code></dd>
       </div>`
    : '';
  const noteRowHtml =
    report.worker_note !== null
      ? `<div class="confirmation-row">
           <dt>Worker note</dt>
           <dd class="confirmation-note">${escapeHtml(report.worker_note)}</dd>
         </div>`
      : '';

  const bodyHtml = `
    <section class="card confirmation-card">
      <div class="confirmation-banner" role="status">
        <span aria-hidden="true">&#10003;</span>
        <span>Report #${escapeHtml(String(report.id))} saved</span>
      </div>
      <h1>Bug Report Submitted</h1>
      <p class="machine-meta">${escapeHtml(machine.display_name)} &middot; ID: <code>${escapeHtml(machine.id)}</code></p>

      <dl class="confirmation-details">
        <div class="confirmation-row">
          <dt>Report ID</dt>
          <dd>#${escapeHtml(String(report.id))}</dd>
        </div>
        <div class="confirmation-row">
          <dt>Quick tag</dt>
          <dd>${escapeHtml(report.tag)}</dd>
        </div>
        ${errorRowHtml}
        <div class="confirmation-row">
          <dt>Attached telemetry snapshot</dt>
          <dd>${escapeHtml(snapshotLabel)}</dd>
        </div>
        ${noteRowHtml}
      </dl>

      <a class="recovery-link" href="/m/${escapeHtml(encodedId)}">Back to ${escapeHtml(machine.display_name)}</a>
    </section>
  `;

  return renderPortalLayout({
    title: `Bug Report #${report.id} Submitted · ${machine.display_name} | Winding Room Portal`,
    bodyHtml,
    backHref: `/m/${encodedId}`,
    backLabel: 'Back to Machine',
    extraStyles: REPORT_BUG_STYLES,
  });
}

function extractBodyRecord(body: unknown): Record<string, unknown> {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

/**
 * Register the Worker Portal Report-a-Bug HTML routes on the Fastify instance.
 */
export function registerWorkerBugReport(app: FastifyInstance, db: Pool): void {
  app.get<{ Params: MachineParams }>(
    '/m/:machineId/report-bug',
    {
      schema: {
        hide: true,
      },
    },
    async (request, reply) => {
      const rawMachineId = request.params.machineId;
      const machine = await getMachineById(db, rawMachineId);

      reply.type('text/html; charset=utf-8');
      if (machine === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      return reply.send(renderBugReportFormPage(machine));
    },
  );

  app.post<{ Params: MachineParams }>(
    '/m/:machineId/report-bug',
    {
      schema: {
        hide: true,
      },
    },
    async (request, reply) => {
      const rawMachineId = request.params.machineId;
      const machine = await getMachineById(db, rawMachineId);

      reply.type('text/html; charset=utf-8');
      if (machine === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      const body = extractBodyRecord(request.body);
      const rawTag = body.tag;
      const rawNote = body.worker_note;
      const preservedNote = typeof rawNote === 'string' ? rawNote : '';
      const hasValidTag = isValidBugReportTag(rawTag);
      const hasValidNote =
        rawNote === undefined || rawNote === null || typeof rawNote === 'string';

      if (!hasValidTag || !hasValidNote) {
        return reply.status(400).send(
          renderBugReportFormPage(machine, {
            selectedTag: hasValidTag ? rawTag : undefined,
            workerNote: preservedNote,
            tagError: hasValidTag
              ? undefined
              : 'Please choose what happened before submitting.',
            noteError: hasValidNote ? undefined : 'Note must be plain text.',
          }),
        );
      }

      const created = await createBugReport(db, {
        machineId: machine.id,
        tag: rawTag,
        workerNote: rawNote ?? null,
      });

      if (created === null) {
        return reply.status(404).send(renderUnknownMachinePage(rawMachineId));
      }

      return reply.status(201).send(renderBugReportConfirmationPage(machine, created));
    },
  );
}
