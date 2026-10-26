import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { PhotoEditor } from './PhotoEditor';
import { editedFiles, sendAsFile } from './editPhoto';

beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('PhotoEditor', () => {
  it('sends the untouched file with a caption and can send as the original file', async () => {
    const user = userEvent.setup();
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const onSend = vi.fn();
    render(<PhotoEditor file={file} onSend={onSend} onCancel={vi.fn()} />);
    await user.type(screen.getByLabelText('Caption'), 'hello');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith(file, 'hello');
    expect(editedFiles.has(file)).toBe(true);
    expect(sendAsFile.has(file)).toBe(true);
  });

  it('cancels', () => {
    const onCancel = vi.fn();
    render(
      <PhotoEditor
        file={new File(['x'], 'a.png', { type: 'image/png' })}
        onSend={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
