/*
 * Admin portal integration tests. No REACT_APP_FIREBASE_* variables are set
 * under Jest, so these exercise the demo-mode session and repository.
 */
import {
  render, screen, waitFor, within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../../App';
import { getDemoAdminRepository, listElevators, resetDemoAdminRepository } from '../../services/adminService';
// Warm the lazily loaded admin chunk so tests don't race a cold module load.
import './AdminRoutes';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AppRoutes />
  </MemoryRouter>,
);

const loginHeading = () => screen.findByRole('heading', { name: /Administrator sign in/ });

/** Opens `path`, which redirects to login, then enters demo mode. */
const enterDemoAt = async (path, heading) => {
  renderAt(path);
  userEvent.click(await screen.findByRole('button', { name: 'Continue in demo mode' }));
  return screen.findByRole('heading', { level: 1, name: heading });
};

const loadDemoFloors = async () => (await getDemoAdminRepository().loadBuilding('ENG_MAIN')).floors;

beforeEach(() => {
  window.sessionStorage.clear();
  resetDemoAdminRepository();
});

describe('admin route protection', () => {
  test.each(['/admin/dashboard', '/admin/editor', '/admin/settings'])(
    '%s redirects signed-out visitors to /admin/login',
    async (path) => {
      renderAt(path);
      expect(await loginHeading()).toBeInTheDocument();
      expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    },
  );

  test('/admin and unknown admin paths also end at the login page', async () => {
    renderAt('/admin/unknown-page');
    expect(await loginHeading()).toBeInTheDocument();
  });

  test('without Firebase the form is disabled and demo mode is explained', async () => {
    renderAt('/admin/login');
    await loginHeading();
    expect(screen.getByText('Firebase is not configured')).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  });

  test('signing in returns the admin to the page they originally requested', async () => {
    expect(await enterDemoAt('/admin/settings', 'Settings')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/Demo mode/);
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  });

  test('the session survives a reload within the tab (sessionStorage)', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/admin/login']}><AppRoutes /></MemoryRouter>,
    );
    userEvent.click(await screen.findByRole('button', { name: 'Continue in demo mode' }));
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    unmount();

    renderAt('/admin/editor');
    expect(await screen.findByRole('heading', { level: 1, name: 'Map Editor' })).toBeInTheDocument();
  });

  test('logout from Settings ends the session and protects routes again', async () => {
    await enterDemoAt('/admin/settings', 'Settings');
    const main = screen.getByRole('main');
    userEvent.click(within(main).getByRole('button', { name: 'Logout' }));
    expect(await loginHeading()).toBeInTheDocument();
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('admin dashboard', () => {
  test('shows building statistics', async () => {
    await enterDemoAt('/admin/dashboard', 'Dashboard');
    expect(screen.getByText('Engineering Complex · ENG_MAIN')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total nodes' })).toHaveTextContent('51');
    expect(screen.getByRole('group', { name: 'Floors' })).toHaveTextContent('3');
    expect(screen.getByRole('group', { name: 'Elevators out of service' })).toHaveTextContent('1 / 2');
    expect(screen.getByRole('group', { name: 'Last updated' })).toHaveTextContent('2026');
  });

  test('toggling an elevator marks it out of service on every floor', async () => {
    await enterDemoAt('/admin/dashboard', 'Dashboard');
    const toggle = screen.getByRole('switch', { name: 'Elevator 1 (Central) out of service' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    userEvent.click(toggle);

    await waitFor(() => expect(
      screen.getByRole('switch', { name: 'Elevator 1 (Central) out of service' }),
    ).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByRole('group', { name: 'Elevators out of service' })).toHaveTextContent('2 / 2');

    const elevator = listElevators(await loadDemoFloors()).find((e) => e.key === 'ELEV_1');
    expect(elevator.outOfService).toBe(true);
    (await loadDemoFloors()).forEach((floor) => {
      expect(floor.graph_topology.nodes.find((n) => n.transition_id === 'ELEV_1').out_of_service).toBe(true);
    });
  });

  test('putting an elevator back in service', async () => {
    await enterDemoAt('/admin/dashboard', 'Dashboard');
    userEvent.click(screen.getByRole('switch', { name: 'Elevator 2 (East) out of service' }));
    await waitFor(() => expect(
      screen.getByRole('switch', { name: 'Elevator 2 (East) out of service' }),
    ).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('group', { name: 'Elevators out of service' })).toHaveTextContent('0 / 2');
  });

  test('closing a corridor on a chosen floor', async () => {
    await enterDemoAt('/admin/dashboard', 'Dashboard');
    userEvent.selectOptions(screen.getByLabelText('Floor'), '2');
    userEvent.type(screen.getByLabelText('Search'), 'Hallway 2-A ↔ Hallway 2-B');
    const toggle = screen.getByRole('switch', { name: 'Close passage Hallway 2-A ↔ Hallway 2-B' });

    userEvent.click(toggle);

    await waitFor(() => expect(
      screen.getByRole('switch', { name: 'Close passage Hallway 2-A ↔ Hallway 2-B' }),
    ).toHaveAttribute('aria-checked', 'true'));
    const floor2 = (await loadDemoFloors()).find((f) => f.floor_number === 2);
    expect(floor2.graph_topology.edges.find((e) => e.source === 'F2_HALL_1' && e.target === 'F2_HALL_2'))
      .toMatchObject({ out_of_service: true });
  });
});

describe('admin map editor', () => {
  const nodesCardTitle = (floor, count) => `Nodes on floor ${floor} (${count})`;

  test('adds a node, edits it, connects it and saves the floor', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    expect(screen.getByText(nodesCardTitle(1, 18))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save floor 1' })).toBeDisabled();

    userEvent.selectOptions(screen.getByLabelText('New node type'), 'room');
    userEvent.click(screen.getByRole('button', { name: 'Add at center' }));
    expect(screen.getByText(nodesCardTitle(1, 19))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Node properties' })).toBeInTheDocument();

    const label = screen.getByLabelText('Label');
    expect(label).toHaveValue('New room');
    userEvent.clear(label);
    userEvent.type(label, 'Study Room 110{enter}');
    expect(within(screen.getByRole('list', { name: 'Nodes' })).getByText('Study Room 110')).toBeInTheDocument();

    userEvent.selectOptions(screen.getByLabelText('Connect to node'), 'F1_HALL_2');
    userEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(screen.getByRole('heading', { name: 'Connections (1)' })).toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Save floor 1' }));
    expect(await screen.findByText('Floor 1 saved (demo session only).')).toBeInTheDocument();

    const floor1 = (await loadDemoFloors()).find((f) => f.floor_number === 1).graph_topology;
    const saved = floor1.nodes.find((n) => n.name === 'Study Room 110');
    expect(saved).toMatchObject({ id: 'F1_ROOM_1', type: 'room', is_accessible: true });
    expect(floor1.edges.find((e) => e.source === saved.id)).toMatchObject({ target: 'F1_HALL_2', type: 'corridor' });
  });

  test('changing a node to stairs makes it inaccessible and gives it a transition id', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    userEvent.click(within(screen.getByRole('list', { name: 'Nodes' })).getByText('Reception'));

    userEvent.selectOptions(screen.getByLabelText('Type'), 'stairs');

    expect(screen.getByLabelText(/Step-free accessible/)).not.toBeChecked();
    expect(screen.getByLabelText(/Step-free accessible/)).toBeDisabled();
    expect(screen.getByLabelText('Transition ID')).toHaveValue('STAIRS_1');
  });

  test('deleting a node removes its connections, and undo restores them', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    userEvent.click(within(screen.getByRole('list', { name: 'Nodes' })).getByText('Cafeteria'));
    expect(screen.getByRole('heading', { name: 'Connections (1)' })).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Delete node' }));
    expect(screen.getByText(nodesCardTitle(1, 17))).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Nodes' })).queryByText('Cafeteria')).not.toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByText(nodesCardTitle(1, 18))).toBeInTheDocument();
    userEvent.click(within(screen.getByRole('list', { name: 'Nodes' })).getByText('Cafeteria'));
    expect(screen.getByRole('heading', { name: 'Connections (1)' })).toBeInTheDocument();
  });

  test('editing a connection: close it and change its type', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    userEvent.click(within(screen.getByRole('list', { name: 'Nodes' })).getByText('Cafeteria'));
    userEvent.click(screen.getByRole('button', { name: /^Hallway 1-E · \d+ m$/ }));
    expect(screen.getByRole('heading', { name: 'Connection properties' })).toBeInTheDocument();

    userEvent.click(screen.getByLabelText(/Closed \(out of service\)/));
    userEvent.selectOptions(screen.getByLabelText('Type'), 'ramp');
    userEvent.click(screen.getByRole('button', { name: 'Save floor 1' }));
    await screen.findByText('Floor 1 saved (demo session only).');

    const floor1 = (await loadDemoFloors()).find((f) => f.floor_number === 1).graph_topology;
    const cafeteria = floor1.nodes.find((n) => n.name === 'Cafeteria');
    expect(floor1.edges.find((e) => e.target === cafeteria.id)).toMatchObject({ type: 'ramp', out_of_service: true });
  });

  test('validation blocks saving a duplicate transition id on one floor', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    userEvent.selectOptions(screen.getByLabelText('New node type'), 'elevator');
    userEvent.click(screen.getByRole('button', { name: 'Add at center' }));
    const transition = screen.getByLabelText('Transition ID');
    expect(transition).toHaveValue('ELEV_3');
    userEvent.clear(transition);
    userEvent.type(transition, 'ELEV_1{enter}');

    userEvent.click(screen.getByRole('button', { name: 'Save floor 1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Transition id "ELEV_1" is used by 2 nodes on this floor.');
    expect((await loadDemoFloors())[0].graph_topology.nodes).toHaveLength(18);
  });

  test('switching floors with unsaved changes asks for confirmation', async () => {
    await enterDemoAt('/admin/editor', 'Map Editor');
    userEvent.click(screen.getByRole('button', { name: 'Add at center' }));
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);

    userEvent.selectOptions(screen.getByLabelText('Floor'), '2');
    expect(screen.getByText(nodesCardTitle(1, 19))).toBeInTheDocument();

    userEvent.selectOptions(screen.getByLabelText('Floor'), '2');
    expect(await screen.findByText(nodesCardTitle(2, 17))).toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    confirmSpy.mockRestore();
  });
});
