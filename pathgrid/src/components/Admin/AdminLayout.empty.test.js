/*
 * Admin portal with an EMPTY buildings collection (status === 'empty').
 * Settings must stay reachable so "Load sample building" can bootstrap the
 * database; Dashboard and Map Editor keep the empty-state notice.
 */
import {
  render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';
import { getDemoAdminRepository, resetDemoAdminRepository } from '../../services/adminService';
// Warm the lazily loaded admin chunk so tests don't race a cold module load.
import './AdminRoutes';

// Demo sessions use an initially EMPTY in-memory database.
jest.mock('../../services/adminService', () => {
  const actual = jest.requireActual('../../services/adminService');
  let repository = null;
  return {
    ...actual,
    getDemoAdminRepository: () => {
      if (!repository) repository = actual.createDemoAdminRepository({ buildings: [], floors: [] });
      return repository;
    },
    resetDemoAdminRepository: () => { repository = null; },
  };
});

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AppRoutes />
  </MemoryRouter>,
);

const signInToDemoAt = async (path) => {
  renderAt(path);
  userEvent.click(await screen.findByRole('button', { name: 'Continue in demo mode' }));
};

beforeEach(() => {
  window.sessionStorage.clear();
  resetDemoAdminRepository();
});

describe('empty buildings collection', () => {
  test('/admin/settings still renders, with an informational notice', async () => {
    await signInToDemoAt('/admin/settings');

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByText('No buildings yet.')).toBeInTheDocument();
    expect(within(main).queryByText(/No buildings found/)).not.toBeInTheDocument();

    // Null building / no floors render as placeholders, not crashes.
    expect(screen.getByText('No building yet. Load the sample building below to get started.')).toBeInTheDocument();
    expect(screen.getByText('0 loaded (total_floors: —)')).toBeInTheDocument();
    expect(screen.getByText(/There are no buildings in the database yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load sample building' })).toBeEnabled();
    expect(within(main).getByRole('button', { name: 'Logout' })).toBeInTheDocument();
  });

  test('loading the sample building from Settings bootstraps the database', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
    await signInToDemoAt('/admin/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });

    userEvent.click(screen.getByRole('button', { name: 'Load sample building' }));

    // The page stays mounted (silent reload), so the confirmation survives.
    expect(await screen.findByText('Loaded 1 building and 3 floors.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('No buildings yet.')).not.toBeInTheDocument());
    const main = screen.getByRole('main');
    expect(within(main).getByText('Engineering Complex')).toBeInTheDocument();
    expect(within(main).getByText('3 loaded (total_floors: 3)')).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/REPLACES buildings\/ENG_MAIN/));

    const { floors } = await getDemoAdminRepository().loadBuilding('ENG_MAIN');
    expect(floors).toHaveLength(3);

    // The rest of the portal now works.
    userEvent.click(screen.getByRole('link', { name: 'Dashboard' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  test('cancelling the confirmation changes nothing', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);
    await signInToDemoAt('/admin/settings');
    await screen.findByRole('heading', { level: 1, name: 'Settings' });

    userEvent.click(screen.getByRole('button', { name: 'Load sample building' }));

    expect(screen.getByText('No buildings yet.')).toBeInTheDocument();
    expect(await getDemoAdminRepository().listBuildings()).toEqual([]);
    confirmSpy.mockRestore();
  });

  test.each([
    ['/admin/dashboard', 'Dashboard'],
    ['/admin/editor', 'Map Editor'],
  ])('%s keeps the empty-state notice instead of the page', async (path, heading) => {
    await signInToDemoAt(path);

    const main = await screen.findByRole('main');
    expect(await within(main).findByText(/No buildings found/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: heading })).not.toBeInTheDocument();

    // ...with a way out to Settings.
    userEvent.click(within(main).getByRole('link', { name: 'load the sample building from Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  });
});
