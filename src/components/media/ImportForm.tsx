'use client';

import { useMemo, useState } from 'react';
import type { CollectionSummary } from '@/capabilities/media';
import { callCapability } from './capabilityClient';
import { describeJob, Uploader, type UploadJob, type UploaderApi, defaultApi } from './uploader';

/**
 * Professional import: rights first, then files. The import capability issues the tickets with the
 * rights draft attached; the same upload engine sends the bytes and completes each file.
 */
export function ImportForm({ chapters }: { chapters: CollectionSummary[] }) {
  const [vendorName, setVendorName] = useState('');
  const [collection, setCollection] = useState(chapters[0]?.slug ?? '');
  const [copyrightHolder, setCopyrightHolder] = useState('');
  const [provenance, setProvenance] = useState('');
  const [licenseNote, setLicenseNote] = useState('Personal, non-commercial online display');
  const [usageNotes, setUsageNotes] = useState('');
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const api = useMemo<UploaderApi>(
    () => ({
      ...defaultApi,
      create: (files) =>
        callCapability('admin_import_professional_media', { vendorName, collection, files, rights: { copyrightHolder, provenance, licenseNote, ...(usageNotes ? { usageNotes } : {}), allowAiProcessing: false } }, { mutation: true }),
    }),
    [vendorName, collection, copyrightHolder, provenance, licenseNote, usageNotes],
  );
  const uploader = useMemo(() => new Uploader({ api, onChange: setJobs, concurrency: 2 }), [api]);
  const ready = vendorName.trim().length > 1 && copyrightHolder.trim().length > 1 && provenance.trim().length > 1 && licenseNote.trim().length > 1 && collection;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      <label className="media-field">
        <span>Vendor (as on the contract)</span>
        <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} required maxLength={120} placeholder="Brooke Alaina Photography" />
      </label>
      <label className="media-field">
        <span>Chapter</span>
        <select value={collection} onChange={(e) => setCollection(e.target.value)}>
          {chapters.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <label className="media-field">
        <span>Copyright holder</span>
        <input value={copyrightHolder} onChange={(e) => setCopyrightHolder(e.target.value)} required maxLength={200} />
      </label>
      <label className="media-field">
        <span>Provenance (how and when these files were delivered)</span>
        <input value={provenance} onChange={(e) => setProvenance(e.target.value)} required maxLength={500} />
      </label>
      <label className="media-field">
        <span>Licence note (shown with the credit)</span>
        <input value={licenseNote} onChange={(e) => setLicenseNote(e.target.value)} required maxLength={500} />
      </label>
      <label className="media-field">
        <span>Usage notes (internal)</span>
        <textarea value={usageNotes} onChange={(e) => setUsageNotes(e.target.value)} maxLength={1000} rows={3} />
      </label>
      <p className="media-note">Third-party AI processing of professional media stays off. It can only be switched on with the vendor&apos;s written confirmation and the legal readiness switch; it is never granted from this form.</p>
      <div className="media-dropzone">
        <label htmlFor="import-files" className="media-button" aria-disabled={!ready}>
          Choose files to import
        </label>
        <input
          id="import-files"
          type="file"
          multiple
          disabled={!ready}
          onChange={(e) => {
            if (!ready) return setNotice('Fill in the vendor and rights fields first.');
            if (e.target.files) uploader.add(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <p className="media-dropzone__hint">Originals stay private under the vendor&apos;s prefix. Publishing is a separate approval in the queue.</p>
      </div>
      {notice ? (
        <p role="status" className="media-note">
          {notice}
        </p>
      ) : null}
      {jobs.length > 0 ? (
        <ul className="media-upload-list" aria-label="Import progress" aria-live="polite">
          {jobs.map((job) => (
            <li key={job.clientRef} className="media-upload-row" data-state={job.state}>
              <span className="media-upload-row__preview media-upload-row__preview--video" aria-hidden="true">
                {job.file.type.startsWith('video/') ? 'video' : 'photo'}
              </span>
              <div>
                <p className="media-upload-row__name">{job.file.name}</p>
                <p className="media-upload-row__meta" data-tone={job.state === 'error' ? 'error' : undefined}>
                  {describeJob(job)}
                </p>
                {['queued', 'preparing', 'uploading', 'finishing'].includes(job.state) ? <progress className="media-progress" value={Math.round(job.progress * 100)} max={100} aria-label={`${job.file.name} progress`} /> : null}
              </div>
              <div className="media-upload-row__actions media-actions">
                {job.state === 'error' ? (
                  <button type="button" className="media-button media-button--secondary" onClick={() => void uploader.retry(job.clientRef)}>
                    Retry
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
