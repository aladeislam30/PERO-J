import { useState } from 'react';

export const MAX_TITLE_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 1000;

const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'];

/**
 * Strip HTML tags and dangerous characters from user-provided market content.
 * Prevents stored XSS when titles/descriptions are rendered by clients.
 */
export function sanitizeText(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/**
 * Validate an external evidence/source URL. Only absolute http(s) URLs pass.
 */
export function isValidEvidenceUrl(input: string): boolean {
  if (!input) return false;
  try {
    const url = new URL(input.trim());
    return ALLOWED_URL_PROTOCOLS.includes(url.protocol);
  } catch {
    return false;
  }
}

export interface CreateMarketPayload {
  title: string;
  description: string;
  sourceUrl: string;
}

export interface CreateMarketProps {
  onSubmit?: (payload: CreateMarketPayload) => void | Promise<void>;
}

export default function CreateMarket({ onSubmit }: CreateMarketProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const cleanTitle = sanitizeText(title);
    const cleanDescription = sanitizeText(description);
    const cleanUrl = sourceUrl.trim();

    if (!cleanTitle) {
      setError('Title is required.');
      return;
    }
    if (cleanTitle.length > MAX_TITLE_LENGTH) {
      setError(`Title must be ${MAX_TITLE_LENGTH} characters or fewer.`);
      return;
    }
    if (cleanDescription.length > MAX_DESCRIPTION_LENGTH) {
      setError(`Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`);
      return;
    }
    if (cleanUrl && !isValidEvidenceUrl(cleanUrl)) {
      setError('Source URL must be a valid http(s) URL.');
      return;
    }

    try {
      setSubmitting(true);
      await onSubmit?.({
        title: cleanTitle,
        description: cleanDescription,
        sourceUrl: cleanUrl,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create market.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="market-title">Title</label>
        <input
          id="market-title"
          type="text"
          value={title}
          maxLength={MAX_TITLE_LENGTH}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <span>{title.length}/{MAX_TITLE_LENGTH}</span>
      </div>

      <div>
        <label htmlFor="market-description">Description</label>
        <textarea
          id="market-description"
          value={description}
          maxLength={MAX_DESCRIPTION_LENGTH}
          onChange={(e) => setDescription(e.target.value)}
        />
        <span>{description.length}/{MAX_DESCRIPTION_LENGTH}</span>
      </div>

      <div>
        <label htmlFor="market-source-url">Source URL</label>
        <input
          id="market-source-url"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          placeholder="https://example.com/evidence"
        />
      </div>

      {error && <p role="alert">{error}</p>}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create Market'}
      </button>
    </form>
  );
}
