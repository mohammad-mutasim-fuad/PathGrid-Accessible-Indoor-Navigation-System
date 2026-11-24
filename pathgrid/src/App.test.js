import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from './App';
// Warm the lazily loaded admin chunk so the /admin test doesn't race a cold module load.
import './components/Admin/AdminRoutes';

const renderAt = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <AppRoutes />
  </MemoryRouter>,
);

/** Waits until the mock building has loaded into the selectors. */
const waitForPlanner = async () => {
  const start = await screen.findByLabelText('Start location');
  await waitFor(() => expect(within(start).getAllByRole('option').length).toBeGreaterThan(1));
  return { start, destination: screen.getByLabelText('Destination') };
};

describe('Public navigation view (/)', () => {
  test('renders header links, map, floor picker and route planner', async () => {
    renderAt('/');
    await waitForPlanner();

    expect(screen.getByRole('link', { name: /PathGrid/ })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /help/i })).toHaveAttribute('href', '/help');
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute('href', '/admin/login');
    expect(screen.getByRole('img', { name: /Map of floor 1/ })).toBeInTheDocument();
    expect(screen.getByText('Engineering Complex')).toBeInTheDocument();

    const floorNav = screen.getByRole('navigation', { name: 'Floor selector' });
    expect(within(floorNav).getAllByRole('button').map((b) => b.textContent)).toEqual(['3', '2', '1']);
    expect(within(floorNav).getByRole('button', { name: 'Floor 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Find Route' })).toBeDisabled();
  });

  test('floor buttons switch the visible floor', async () => {
    renderAt('/');
    await waitForPlanner();
    userEvent.click(screen.getByRole('button', { name: 'Floor 2' }));
    expect(screen.getByRole('button', { name: 'Floor 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('img', { name: /Map of floor 2/ })).toBeInTheDocument();
  });

  test('?start= from a QR code pre-selects the start location', async () => {
    renderAt('/?building=ENG_MAIN&start=N100');
    const { start } = await waitForPlanner();
    await waitFor(() => expect(start).toHaveValue('N100'));
    expect(screen.getByText(/Start set from QR code: Main Entrance/)).toBeInTheDocument();
  });

  test('an unknown QR start shows a notice', async () => {
    renderAt('/?startNode=NOPE');
    await waitForPlanner();
    expect(await screen.findByText(/QR code location was not found/)).toBeInTheDocument();
  });

  test('finds a multi-floor route and lists step-by-step directions', async () => {
    renderAt('/?start=N100');
    const { start, destination } = await waitForPlanner();
    await waitFor(() => expect(start).toHaveValue('N100'));

    const deansOffice = within(destination).getByRole('option', { name: "Dean's Office" });
    userEvent.selectOptions(destination, deansOffice);
    userEvent.click(screen.getByRole('button', { name: 'Find Route' }));

    expect(await screen.findByText(/Route found:/)).toBeInTheDocument();
    expect(screen.getByText("Arrive at Dean's Office")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Floor 3, on your route' })).toBeInTheDocument();

    // The route climbs 1 -> 2 -> 3; the prompt walks the user through each floor.
    userEvent.click(screen.getByRole('button', { name: 'Switch to Floor 2' }));
    expect(screen.getByRole('img', { name: /Map of floor 2/ })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Switch to Floor 3' }));
    expect(screen.getByRole('img', { name: /Map of floor 3\. Your route is highlighted/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Switch to Floor/ })).not.toBeInTheDocument();
  });

  test('wheelchair mode avoids stairs and explains unreachable rooms', async () => {
    renderAt('/?start=N100');
    const { start, destination } = await waitForPlanner();
    await waitFor(() => expect(start).toHaveValue('N100'));

    const toggle = screen.getByRole('switch', { name: 'Wheelchair accessible route' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    userEvent.selectOptions(destination, within(destination).getByRole('option', { name: 'Seminar Room 301' }));
    userEvent.click(screen.getByRole('button', { name: 'Find Route' }));
    expect(await screen.findByText('Take Elevator 1 (Central) to floor 2')).toBeInTheDocument();
    expect(screen.queryByText(/Staircase/)).not.toBeInTheDocument();

    userEvent.selectOptions(
      destination,
      within(destination).getByRole('option', { name: /Server Room \(Raised Floor\) \(not step-free\)/ }),
    );
    userEvent.click(screen.getByRole('button', { name: 'Find Route' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('is not step-free accessible');
  });

  test('turning wheelchair mode on re-routes an existing route', async () => {
    renderAt('/?start=N100');
    const { start, destination } = await waitForPlanner();
    await waitFor(() => expect(start).toHaveValue('N100'));

    userEvent.selectOptions(destination, within(destination).getByRole('option', { name: 'Seminar Room 301' }));
    userEvent.click(screen.getByRole('button', { name: 'Find Route' }));
    expect(await screen.findByText('Take Staircase A (West) to floor 2')).toBeInTheDocument();

    userEvent.click(screen.getByRole('switch', { name: 'Wheelchair accessible route' }));
    expect(await screen.findByText('Take Elevator 1 (Central) to floor 2')).toBeInTheDocument();
    expect(screen.queryByText(/Take Staircase/)).not.toBeInTheDocument();
  });
});

describe('Other routes', () => {
  test('/help renders the map legend', () => {
    renderAt('/help');
    expect(screen.getByRole('heading', { level: 1, name: /Help & Map Legend/ })).toBeInTheDocument();
    ['Stairs', 'Elevator', 'Elevator out of service'].forEach((label) => {
      expect(screen.getByText(label, { selector: 'span' })).toBeInTheDocument();
    });
    expect(screen.getByRole('heading', { name: 'Wheelchair Mode' })).toBeInTheDocument();
  });

  test('/admin/login lazy-loads the admin sign-in page', async () => {
    renderAt('/admin/login');
    expect(await screen.findByRole('heading', { name: /Administrator sign in/ })).toBeInTheDocument();
  });

  test('unknown paths render a not-found page', () => {
    renderAt('/does-not-exist');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
