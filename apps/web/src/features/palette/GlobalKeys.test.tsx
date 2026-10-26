import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GlobalKeys } from './GlobalKeys';

describe('GlobalKeys', () => {
  it('opens the palette on Ctrl+K and the cheat sheet on ?', () => {
    render(
      <MemoryRouter>
        <GlobalKeys />
      </MemoryRouter>,
    );
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByLabelText('Search commands')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: '?' });
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
  });
});
