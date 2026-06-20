import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';

const MENTION_TOKEN = /@([\w.-]*)$/;
const MAX_SUGGESTIONS = 6;

export interface MentionAutocomplete {
  /** The active partial mention token, or null when not mentioning. */
  query: string | null;
  active: boolean;
  /** Agent names matching the current query (empty when inactive). */
  matches: string[];
  /** Wrap the text input's onChange: updates the value and tracks the @token. */
  onChange: (value: string) => void;
  /** Replace the in-progress @token with the chosen agent. */
  apply: (name: string) => void;
  /** Dismiss the suggestion list. */
  close: () => void;
}

/**
 * Lightweight @-mention autocomplete for a plain text input. Owns the mention
 * detection/selection; the input value itself stays in the caller's state.
 */
export function useMentionAutocomplete(
  agentNames: string[],
  setValue: Dispatch<SetStateAction<string>>,
): MentionAutocomplete {
  const [query, setQuery] = useState<string | null>(null);

  const matches = useMemo(() => {
    if (query === null) {
      return [];
    }
    const normalized = query.toLowerCase();
    return agentNames.filter((name) => name.toLowerCase().includes(normalized)).slice(0, MAX_SUGGESTIONS);
  }, [agentNames, query]);

  const onChange = (value: string) => {
    setValue(value);
    const match = value.match(MENTION_TOKEN);
    setQuery(match ? match[1] : null);
  };

  const apply = (name: string) => {
    setValue((prev) => prev.replace(MENTION_TOKEN, `@${name} `));
    setQuery(null);
  };

  const close = () => setQuery(null);

  return { query, active: query !== null, matches, onChange, apply, close };
}
