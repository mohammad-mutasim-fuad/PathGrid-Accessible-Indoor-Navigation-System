/*
 * Admin portal with Firebase configured: real (mocked) Email/Password auth,
 * no demo mode, and writes going through the live repository.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';
import {
  signInAdmin, signOutAdmin, subscribeToAuthChanges,
} from '../../services/authService';
import { liveAdminRepository } from '../../services/adminService';
// Warm the lazily loaded admin chunk so tests don't race a cold module load.
import './AdminRoutes';

jest.mock('../../services/firebase', () => ({
  isFirebaseConfigured: true,
  firebaseConfigError: null,
  app: { options: { projectId: 'pathgrid-test' } },
  db: {},
  requireDb: () => ({}),
}));

jest.mock('../../services/authService', () => {
  const actual = jest.requireActual('../../services/authService');
  return {
    ...actual,
    subscribeToAuthChanges: jest.fn(),
    signInAdmin: jest.fn(),
    signOutAdmin: jest.fn(),
  };
});

// Live repository backed by an in-memory store, with spies on the writes.
// CRA enables `resetMocks`, so implementations are re-attached in beforeEach.
jest.mock('../../services/adminService', () => {
  const actual = jest.requireActual('../../services/adminService');
  const store = actual.createDemoAdminRepository();
  return {
    ...actual,
    liveAdminRepository: {
      ...store,
      mode: 'live',
      backingStore: store,
      setElevatorOutOfService: jest.fn(),
      setEdgeOutOfService: jest.fn(),
      saveFloorTopology: jest.fn(),
    },
  };
});

const ADMIN = {
  uid: 'u-1',
  email: 'facilities@university.edu',
  displayName: 'Facilities Team',
  lastSignInTime: '2026-11-20T09:00:00Z',
  creationTime: '2026-01-10T09:00:00Z',
  isDemo: false,
};

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AppRoutes />
  </MemoryRouter>,
);

const mockAuthState = (user) => {
  subscribeToAuthChanges.mockImplementation((callback) => {
    callback(user);
    return () => {};
  });
};

beforeEach(() => {
  window.sessionStorage.clear();
  const { backingStore } = liveAdminRepository;
  liveAdminRepository.setElevatorOutOfService.mockImplementation(backingStore.setElevatorOutOfService);
  liveAdminRepository.setEdgeOutOfService.mockImplementation(backingStore.setEdgeOutOfService);
  liveAdminRepository.saveFloorTopology.mockImplementation(backingStore.saveFloorTopology);
});

describe('route protection with Firebase Auth', () => {
  test('shows a session check while Firebase restores the session', async () => {
    subscribeToAuthChanges.mockImplementation(() => () => {});
    renderAt('/admin/dashboard');
    expect(await screen.findByText('Checking your session…')).toBeInTheDocument();
  });

  test('signed-out users are redirected to login, which has no demo option', async () => {
    mockAuthState(null);
    renderAt('/admin/editor');
    expect(await screen.findByRole('heading', { name: /Administrator sign in/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue in demo mode' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeEnabled();
  });

  test('a demo session flag cannot bypass real authentication', async () => {
    window.sessionStorage.setItem('pathgrid.adminDemoSession', '1');
    mockAuthState(null);
    renderAt('/admin/dashboard');
    expect(await screen.findByRole('heading', { name: /Administrator sign in/ })).toBeInTheDocument();
  });

  test('signing in with email and password opens the requested page', async () => {
    mockAuthState(null);
    signInAdmin.mockResolvedValue(ADMIN);
    renderAt('/admin/settings');

    userEvent.type(await screen.findByLabelText('Email address'), ADMIN.email);
    userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(signInAdmin).toHaveBeenCalledWith(ADMIN.email, 'correct horse');
    expect(screen.getAllByText(ADMIN.email).length).toBeGreaterThan(0);
    expect(screen.getByText('pathgrid-test')).toBeInTheDocument();
  });

  test('wrong credentials show a friendly error', async () => {
    mockAuthState(null);
    signInAdmin.mockRejectedValue(Object.assign(new Error('raw'), { code: 'auth/invalid-credential' }));
    renderAt('/admin/login');

    userEvent.type(await screen.findByLabelText('Email address'), ADMIN.email);
    userEvent.type(screen.getByLabelText('Password'), 'nope');
    userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
  });

  test('signed-in admins reach the dashboard and can log out', async () => {
    mockAuthState(ADMIN);
    signOutAdmin.mockResolvedValue();
    renderAt('/admin/dashboard');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    userEvent.click(screen.getAllByRole('button', { name: 'Logout' })[0]);
    expect(await screen.findByRole('heading', { name: /Administrator sign in/ })).toBeInTheDocument();
    expect(signOutAdmin).toHaveBeenCalledTimes(1);
  });
});

describe('out-of-service toggles call the live repository', () => {
  test('elevator toggle calls setElevatorOutOfService with the shaft id', async () => {
    mockAuthState(ADMIN);
    renderAt('/admin/dashboard');
    userEvent.click(await screen.findByRole('switch', { name: 'Elevator 1 (Central) out of service' }));

    await waitFor(() => expect(liveAdminRepository.setElevatorOutOfService)
      .toHaveBeenCalledWith('ENG_MAIN', 'ELEV_1', true));
    await waitFor(() => expect(
      screen.getByRole('switch', { name: 'Elevator 1 (Central) out of service' }),
    ).toHaveAttribute('aria-checked', 'true'));
  });

  test('a failed write shows an error and leaves the switch unchanged', async () => {
    mockAuthState(ADMIN);
    liveAdminRepository.setElevatorOutOfService.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
    renderAt('/admin/dashboard');
    userEvent.click(await screen.findByRole('switch', { name: 'Elevator 2 (East) out of service' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Missing or insufficient permissions.');
    expect(screen.getByRole('switch', { name: 'Elevator 2 (East) out of service' })).toHaveAttribute('aria-checked', 'true');
  });
});
