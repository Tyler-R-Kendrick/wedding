'use client';

import { useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { CollectionSummary } from '@/capabilities/media';
import { AdminFlow, type FlowContext, type FlowStep } from '@/components/admin/flow/AdminFlow';
import { ChoiceField, ReviewList, SelectField, TextField } from '@/components/admin/flow/fields';
import type { CapabilityResponse } from '@/components/handoff/client';
import type { CapabilityErrorCode } from '@/contracts/errors';
import { callCapability, type CapabilityFailure } from './capabilityClient';
import { describeJob, defaultApi, Uploader, type UploadJob } from './uploader';
import './admin-media.css';

interface ImportValues extends Record<string, unknown> {
  vendorName: string;
  collection: string;
  copyrightHolder: string;
  provenance: string;
  licenseNote: string;
  usageNotes: string;
  /** How many files are chosen, as text. The files themselves live outside the draft: a browser cannot keep them. */
  files: string;
}

interface ImportSummary {
  uploaded: number;
  already: number;
  failed: number;
}

/** A job the uploader has finished with, one way or another. */
const SETTLED = new Set<UploadJob['state']>(['processing', 'done', 'duplicate', 'error', 'cancelled']);
const IN_FLIGHT = new Set<UploadJob['state']>(['queued', 'preparing', 'uploading', 'finishing']);

/** The upload engine's jobs, readable from inside the sheet and from its Done panel as they change. */
function jobStore() {
  let jobs: UploadJob[] = [];
  const subs = new Set<() => void>();
  return {
    get: () => jobs,
    set(next: UploadJob[]) {
      jobs = next;
      for (const f of subs) f();
    },
    subscribe(f: () => void) {
      subs.add(f);
      return () => void subs.delete(f);
    },
  };
}
type JobStore = ReturnType<typeof jobStore>;
const NONE: UploadJob[] = [];

function useJobs(store: JobStore): UploadJob[] {
  return useSyncExternalStore(store.subscribe, store.get, () => NONE);
}

function size(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Server field paths (`rights.copyrightHolder`) → this flow's fields, so a rejection lands on the right step. */
const FIELD_OF: Record<string, keyof ImportValues & string> = {
  vendorName: 'vendorName',
  collection: 'collection',
  'rights.copyrightHolder': 'copyrightHolder',
  'rights.provenance': 'provenance',
  'rights.licenseNote': 'licenseNote',
  'rights.usageNotes': 'usageNotes',
};

const need = (v: string, message: string) => (v.trim().length < 2 ? message : undefined);

/**
 * Import a photographer's or videographer's delivery: who delivered it and into which chapter, the
 * rights it comes with, then the files — read back before anything is sent.
 *
 * It was one long form whose file picker stayed disabled, without saying why, until five fields
 * were filled. The flow asks one question a step, keeps what was typed on this device (the rights
 * wording is the part worth not retyping), and ends on a Done panel with the counts: uploaded and
 * waiting in the queue, already imported, and any that failed, each with Retry.
 *
 * The upload engine is the guests' (`uploader.ts`); `admin_import_professional_media` issues its
 * tickets with the rights draft attached. Files never go in the draft — a browser cannot keep them
 * — so a resumed flow asks for them again on the last step.
 */
export function ImportForm({ chapters }: { chapters: CollectionSummary[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [store] = useState(jobStore);
  const uploader = useRef<Uploader | null>(null);
  const bytes = files.reduce((n, f) => n + f.size, 0);

  const steps: FlowStep<ImportValues>[] = [
    {
      title: 'Who delivered them',
      fields: ['vendorName', 'collection'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="vendorName" label="Vendor" hint="The studio or person, as the contract names them. Shown in the credit." />
          {chapters.length > 6 ? (
            <SelectField ctx={ctx} name="collection" label="Chapter" options={chapters.map((c) => ({ value: c.slug, label: c.title }))} />
          ) : (
            <ChoiceField ctx={ctx} name="collection" legend="Chapter" choices={chapters.map((c) => ({ value: c.slug, label: c.title, description: c.description ?? undefined }))} />
          )}
        </>
      ),
      next: async (v) => {
        const errors: Record<string, string> = {};
        const vendor = need(v.vendorName, 'Enter the vendor’s name.');
        if (vendor) errors.vendorName = vendor;
        if (!v.collection) errors.collection = 'Choose the chapter these belong to.';
        return { errors };
      },
    },
    {
      title: 'The rights',
      lede: 'Recorded with every file in this delivery, before anything is uploaded.',
      fields: ['copyrightHolder', 'provenance', 'licenseNote', 'usageNotes'],
      render: (ctx) => (
        <>
          <TextField ctx={ctx} name="copyrightHolder" label="Copyright holder" hint="Usually the photographer or their studio." />
          <TextField ctx={ctx} name="provenance" label="How they reached you" hint="The delivery method and the date it arrived. Typed here; nothing is fetched from the vendor’s gallery." />
          <TextField ctx={ctx} name="licenseNote" label="Licence" hint="What the contract allows. Shown with the credit." />
          <TextField ctx={ctx} name="usageNotes" label="Notes for the two of you" multiline rows={3} optional hint="Never shown to guests." />
          <p className="flow-hint">Third-party AI processing of professional media stays off. It needs the vendor’s written confirmation and the legal readiness switch, and it is never granted here.</p>
        </>
      ),
      next: async (v) => {
        const errors: Record<string, string> = {};
        const holder = need(v.copyrightHolder, 'Enter who holds the copyright.');
        const how = need(v.provenance, 'Say how the files reached you.');
        const licence = need(v.licenseNote, 'Say what the licence allows.');
        if (holder) errors.copyrightHolder = holder;
        if (how) errors.provenance = how;
        if (licence) errors.licenseNote = licence;
        return { errors };
      },
    },
    {
      title: 'Choose the files and check',
      lede: 'They upload from this device into the vendor’s private folder. Publishing is a separate approval in the queue.',
      fields: ['files'],
      render: (ctx) => (
        <>
          <FilePicker ctx={ctx} files={files} onChange={setFiles} />
          <ReviewList
            items={[
              { label: 'Vendor', value: ctx.values.vendorName },
              { label: 'Chapter', value: chapters.find((c) => c.slug === ctx.values.collection)?.title ?? '' },
              { label: 'Copyright', value: ctx.values.copyrightHolder },
              { label: 'Delivered', value: ctx.values.provenance },
              { label: 'Licence', value: ctx.values.licenseNote },
              { label: 'Notes', value: ctx.values.usageNotes },
              { label: 'Files', value: files.length ? `${plural(files.length, 'file')}, ${size(bytes)}` : '' },
            ]}
          />
          <Progress store={store} />
        </>
      ),
      ready: () => files.length > 0,
      readyHint: { field: 'files', message: 'Choose at least one file to import.' },
    },
  ];

  const run = async (v: ImportValues): Promise<CapabilityResponse<ImportSummary>> => {
    // The engine reports per file; the reason a whole delivery was refused (a rights field, the chapter) is kept here.
    let refused = null as CapabilityFailure | null;
    let settle: (jobs: UploadJob[]) => void = () => undefined;
    const settled = new Promise<UploadJob[]>((resolve) => (settle = resolve));
    const engine = new Uploader({
      concurrency: 2,
      api: {
        ...defaultApi,
        create: async (list) => {
          const r = await callCapability<unknown>(
            'admin_import_professional_media',
            {
              vendorName: v.vendorName.trim(),
              collection: v.collection,
              files: list,
              rights: { copyrightHolder: v.copyrightHolder.trim(), provenance: v.provenance.trim(), licenseNote: v.licenseNote.trim(), ...(v.usageNotes.trim() ? { usageNotes: v.usageNotes.trim() } : {}), allowAiProcessing: false },
            },
            { mutation: true },
          );
          if (!r.ok) refused = r.error;
          return r as Awaited<ReturnType<typeof defaultApi.create>>;
        },
      },
      onChange: (jobs) => {
        store.set(jobs);
        if (jobs.length && jobs.every((j) => SETTLED.has(j.state))) settle(jobs);
      },
    });
    uploader.current = engine;
    engine.add(files);
    const jobs = await settled;
    const summary: ImportSummary = {
      uploaded: jobs.filter((j) => j.state === 'processing' || j.state === 'done').length,
      already: jobs.filter((j) => j.state === 'duplicate').length,
      failed: jobs.filter((j) => j.state === 'error').length,
    };
    if (summary.failed === jobs.length && refused) {
      const failure: CapabilityFailure = refused;
      // Nothing went: the delivery itself was refused. Send the admin back to the field that needs fixing.
      const issues = ((failure.details?.issues as { path: string; message: string }[] | undefined) ?? []).map((i) => ({ path: FIELD_OF[i.path] ?? i.path, message: i.message }));
      store.set([]);
      return { ok: false, error: { code: failure.code as CapabilityErrorCode, message: failure.message, details: { issues } } };
    }
    setFiles([]);
    return { ok: true, data: summary };
  };

  if (!chapters.length) {
    return <p className="flow-empty">There is no professional chapter to import into yet. Chapters are created with the site’s albums.</p>;
  }

  return (
    <AdminFlow<ImportValues>
      id="media:import"
      title="Import a delivery"
      trigger={{ label: 'Import a delivery' }}
      initial={{ vendorName: '', collection: chapters[0]?.slug ?? '', copyrightHolder: '', provenance: '', licenseNote: 'Personal, non-commercial online display', usageNotes: '', files: '' }}
      steps={steps}
      submit={{
        label: files.length ? `Import ${plural(files.length, 'file')}` : 'Import',
        success: 'Delivery imported.',
        run,
        result: (data, v) => <Outcome summary={data as ImportSummary} store={store} uploader={uploader} collection={v.collection} />,
      }}
    />
  );
}

/** A native file input with the flow's label, hint and error, so the flow can send focus to it. */
function FilePicker({ ctx, files, onChange }: { ctx: FlowContext<ImportValues>; files: File[]; onChange: (f: File[]) => void }) {
  const id = `${ctx.uid}-files`;
  const error = ctx.errors['files'];
  return (
    <div className="flow-field" data-invalid={error ? '' : undefined}>
      <label htmlFor={id} className="flow-label">
        Files to import
      </label>
      <input
        id={id}
        type="file"
        multiple
        className="im-files"
        disabled={ctx.busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        onChange={(e) => {
          const chosen = Array.from(e.target.files ?? []);
          onChange(chosen);
          ctx.set({ files: String(chosen.length) });
        }}
      />
      <p id={`${id}-hint`} className="flow-hint">
        {files.length ? `${plural(files.length, 'file')} chosen. Choosing again replaces them.` : 'Photos and films, as many as the delivery holds. Originals stay private.'}
      </p>
      {error ? (
        <p id={`${id}-error`} className="flow-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Each file's progress while the import runs. Polite, and only once something is moving. */
function Progress({ store }: { store: JobStore }) {
  const jobs = useJobs(store);
  if (!jobs.length) return null;
  const sent = jobs.filter((j) => SETTLED.has(j.state)).length;
  return (
    <div className="im-progress">
      <p className="flow-copy" aria-live="polite">
        {sent} of {plural(jobs.length, 'file')} sent.
      </p>
      <ul className="im-jobs">
        {jobs.map((job) => (
          <li key={job.clientRef} data-state={job.state}>
            <span className="im-job__name">{job.file.name}</span>
            <span className="im-job__state">{describeJob(job)}</span>
            {IN_FLIGHT.has(job.state) ? <progress value={Math.round(job.progress * 100)} max={100} aria-label={`${job.file.name} progress`} /> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Done panel: what arrived, what was already there, and what to retry. */
function Outcome({ summary, store, uploader, collection }: { summary: ImportSummary; store: JobStore; uploader: RefObject<Uploader | null>; collection: string }) {
  const jobs = useJobs(store);
  const failed = jobs.filter((j) => j.state === 'error' || IN_FLIGHT.has(j.state));
  return (
    <>
      <p>
        {plural(summary.uploaded, 'file')} uploaded and waiting for approval
        {summary.already ? `, ${summary.already} already imported before` : ''}
        {summary.failed ? `, ${summary.failed} did not upload` : ''}.
      </p>
      {failed.length ? (
        <ul className="im-jobs">
          {failed.map((job) => (
            <li key={job.clientRef} data-state={job.state}>
              <span className="im-job__name">{job.file.name}</span>
              <span className="im-job__state">{describeJob(job)}</span>
              {job.state === 'error' ? (
                <button type="button" className="flow-trigger-quiet" aria-label={`Retry ${job.file.name}`} onClick={() => void uploader.current?.retry(job.clientRef)}>
                  Retry
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p>
        <a className="flow-link" href={`/admin/media?collection=${encodeURIComponent(collection)}`}>
          Review them in the queue
        </a>
      </p>
    </>
  );
}
