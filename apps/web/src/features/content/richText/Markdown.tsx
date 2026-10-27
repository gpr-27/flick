import { cn } from '@/components/ui';
import { RichText } from './RichText';

/**
 * Model-written or otherwise markdown-bearing text drawn outside chat bubbles. It inherits the
 * colour and size of its surroundings, wraps long words, keeps headings in proportion and opens
 * links safely (see RichText). Never injects raw HTML. Copy buttons should still copy `text`.
 */
export const Markdown = ({
  text,
  className,
  testId,
}: {
  text: string;
  className?: string;
  testId?: string;
}) => (
  <div
    data-testid={testId}
    className={cn(
      'min-w-0 break-words',
      '[&_h1]:text-base [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm [&_h5]:text-sm [&_h6]:text-xs',
      className,
    )}
  >
    <RichText text={text} inherit className="space-y-1.5" />
  </div>
);
