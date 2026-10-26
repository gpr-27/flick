import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

describe('Avatar fallback', () => {
  it('shows initials when the picture fails to load, and retries when the src changes', () => {
    const { rerender } = render(<Avatar src="https://x/gone.jpg" name="Sam Rao" />);
    fireEvent.error(screen.getByRole('img', { name: 'Sam Rao' }));
    expect(screen.getByText('SR')).toBeInTheDocument();
    rerender(<Avatar src="https://x/new.jpg" name="Sam Rao" />);
    expect(screen.getByRole('img', { name: 'Sam Rao' })).toHaveAttribute(
      'src',
      'https://x/new.jpg',
    );
  });
});
