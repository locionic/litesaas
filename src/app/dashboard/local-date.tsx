'use client';

import { useEffect, useState } from 'react';
// The same helper that produced `serverText`. They have to agree by
// construction: page.tsx renders formatDate(iso) into `serverText`, and this
// component re-renders that exact string in the browser. Written out separately
// the two were free to diverge, and then the row showed the server's answer on
// first paint and silently changed after hydration — a date that edits itself
// under the reader, with no render to attribute it to.
import { formatDate } from '@/lib/utils';

/**
 * A project timestamp, shown in the viewer's own timezone.
 *
 * The server can only format in its own — UTC in the bundled image — so a
 * project created at 02:00 on Tuesday Tokyo time read as Monday here, and as
 * Monday for a London user too. React keeps a server component's text through
 * hydration rather than re-deriving it, so nothing warns: no console error,
 * just a date that quietly disagrees with the user's own clock.
 *
 * `serverText` is rendered on both sides so the hydration matches exactly, and
 * the effect then swaps in the browser's answer. The element's text content is
 * the only thing that ever changes, so there is no layout shift and no second
 * render of the row.
 */
export default function LocalDate({ iso, serverText }: { iso: string; serverText: string }) {
  const [text, setText] = useState(serverText);

  useEffect(() => {
    setText(formatDate(iso));
  }, [iso]);

  // `dateTime` carries the unambiguous instant either way, so a wrong guess
  // about the visible string is still machine-readable.
  return <time dateTime={iso}>{text}</time>;
}
