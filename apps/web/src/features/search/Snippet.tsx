import { Fragment } from 'react';
import { parseSnippet } from './parseSnippet';

export const Snippet = ({ snippet }: { snippet: string }) => (
  <>
    {parseSnippet(snippet).map((p, i) => (
      <Fragment key={i}>
        {p.marked ? <mark className="rounded bg-primary/25 px-0.5">{p.text}</mark> : p.text}
      </Fragment>
    ))}
  </>
);
