import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

/** `render(ui, { wrapper: RouterWrapper })` for components that call router hooks (useNavigate, ...). */
export function RouterWrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}
