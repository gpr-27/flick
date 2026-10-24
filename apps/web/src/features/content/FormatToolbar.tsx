import {
  Bold,
  Code,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Strikethrough,
  Table,
  type LucideIcon,
} from 'lucide-react';
import type { FormatKind } from './markdownFormat';

const BUTTONS: { kind: FormatKind; label: string; Icon: LucideIcon }[] = [
  { kind: 'bold', label: 'Bold', Icon: Bold },
  { kind: 'italic', label: 'Italic', Icon: Italic },
  { kind: 'strike', label: 'Strikethrough', Icon: Strikethrough },
  { kind: 'code', label: 'Inline code', Icon: Code },
  { kind: 'codeblock', label: 'Code block', Icon: Code2 },
  { kind: 'heading', label: 'Heading', Icon: Heading2 },
  { kind: 'bullet', label: 'Bulleted list', Icon: List },
  { kind: 'numbered', label: 'Numbered list', Icon: ListOrdered },
  { kind: 'quote', label: 'Quote', Icon: Quote },
  { kind: 'link', label: 'Link', Icon: Link2 },
  { kind: 'table', label: 'Table', Icon: Table },
];

/** Row of formatting buttons above the message box. They keep the focus in the text field. */
export const FormatToolbar = ({ onFormat }: { onFormat: (kind: FormatKind) => void }) => (
  <div
    role="toolbar"
    aria-label="Text formatting"
    className="mb-2 flex flex-wrap items-center gap-0.5"
  >
    {BUTTONS.map(({ kind, label, Icon }) => (
      <button
        key={kind}
        type="button"
        // mousedown would move the focus (and the selection) out of the text field.
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={() => {
          onFormat(kind);
        }}
        className="btn btn-ghost btn-square btn-sm text-base-content/70"
        aria-label={label}
        title={label}
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    ))}
  </div>
);
