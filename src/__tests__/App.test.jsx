import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../LocalGameController', () => ({
  default: () => <div data-testid="local-controller" />,
}));
vi.mock('../OnlineGameController', () => ({
  default: () => <div data-testid="online-controller" />,
}));

import App from '../App';

describe('App mode router', () => {
  it('renders LocalGameController by default (online flag off)', () => {
    render(<App />);
    expect(screen.getByTestId('local-controller')).toBeInTheDocument();
    expect(screen.queryByTestId('online-controller')).not.toBeInTheDocument();
  });
});
