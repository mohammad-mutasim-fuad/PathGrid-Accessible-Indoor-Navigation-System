/*
 * Regression tests for the admin portal hanging on "Loading building data…"
 * when Firestore holds minimal documents (e.g. buildings/ENG_MAIN with only
 * { name } and no floors).
 */
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdminDataProvider, ADMIN_LOAD_TIMEOUT_MS, useAdminData } from './AdminDataContext';
import { liveAdminRepository } from '../../services/adminService';

jest.mock('./AdminAuthContext', () => ({ useAdminAuth: () => ({ isDemo: false }) }));

jest.mock('../../services/adminService', () => {
  const actual = jest.requireActual('../../services/adminService');
  return {
    ...actual,
    liveAdminRepository: {
      mode: 'live',
      listBuildings: jest.fn(),
      loadBuilding: jest.fn(),
      setElevatorOutOfService: jest.fn(),
      setEdgeOutOfService: jest.fn(),
      saveFloorTopology: jest.fn(),
      seedSampleData: jest.fn(),
    },
  };
});

function Probe() {
  const {
    status, error, building, floors, buildingId, retry,
  } = useAdminData();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="building">{building?.building_name ?? '-'}</p>
      <p data-testid="building-id">{buildingId ?? '-'}</p>
      <p data-testid="floors">{floors.length}</p>
      <p data-testid="error">{error}</p>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  );
}

const renderProvider = () => render(<AdminDataProvider><Probe /></AdminDataProvider>);
const status = () => screen.getByTestId('status').textContent;

afterEach(() => jest.useRealTimers());

test('a minimal building document ({ name } only, no floors) loads instead of hanging', async () => {
  // Exactly what Firestore returns for buildings/ENG_MAIN = { name: "Engineering Main Building" }
  liveAdminRepository.listBuildings.mockResolvedValue([{ id: 'ENG_MAIN', name: 'Engineering Main Building' }]);
  liveAdminRepository.loadBuilding.mockResolvedValue({
    building: { id: 'ENG_MAIN', building_id: 'ENG_MAIN', building_name: 'Engineering Main Building' },
    floors: [],
  });

  renderProvider();

  expect(await screen.findByText('ready')).toBeInTheDocument();
  expect(liveAdminRepository.loadBuilding).toHaveBeenCalledWith('ENG_MAIN');
  expect(screen.getByTestId('building-id')).toHaveTextContent('ENG_MAIN');
  expect(screen.getByTestId('building')).toHaveTextContent('Engineering Main Building');
  expect(screen.getByTestId('floors')).toHaveTextContent('0');
});

test('no buildings at all ends in "empty"', async () => {
  liveAdminRepository.listBuildings.mockResolvedValue([]);
  renderProvider();
  expect(await screen.findByText('empty')).toBeInTheDocument();
  expect(liveAdminRepository.loadBuilding).not.toHaveBeenCalled();
});

test('a failing load ends in "error" with the message', async () => {
  liveAdminRepository.listBuildings.mockResolvedValue([{ id: 'ENG_MAIN' }]);
  liveAdminRepository.loadBuilding.mockRejectedValue(new Error('Missing or insufficient permissions.'));
  renderProvider();
  expect(await screen.findByText('error')).toBeInTheDocument();
  expect(screen.getByTestId('error')).toHaveTextContent('Missing or insufficient permissions.');
});

test('a request that never settles times out into "error" instead of loading forever', async () => {
  jest.useFakeTimers();
  liveAdminRepository.listBuildings.mockReturnValue(new Promise(() => {}));
  renderProvider();
  expect(status()).toBe('loading');

  await act(async () => { jest.advanceTimersByTime(ADMIN_LOAD_TIMEOUT_MS); });

  expect(status()).toBe('error');
  expect(screen.getByTestId('error')).toHaveTextContent(/timed out/);
});

test('Retry always reloads, even when the selected building is unchanged', async () => {
  liveAdminRepository.listBuildings.mockResolvedValue([{ id: 'ENG_MAIN', building_id: 'ENG_MAIN' }]);
  liveAdminRepository.loadBuilding
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValueOnce({ building: { building_id: 'ENG_MAIN', building_name: 'Eng' }, floors: [] });
  renderProvider();
  expect(await screen.findByText('error')).toBeInTheDocument();

  userEvent.click(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('ready')).toBeInTheDocument();
  expect(liveAdminRepository.loadBuilding).toHaveBeenCalledTimes(2);
});
