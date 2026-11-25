/*
 * Settings must render without errors when no building is loaded
 * (status 'empty': building === null, floors === []), including malformed
 * floors values.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Settings from './Settings';
import { useAdminData } from './AdminDataContext';

jest.mock('./AdminAuthContext', () => ({
  useAdminAuth: () => ({
    user: { uid: 'u1', email: 'facilities@university.edu', displayName: '' },
    isDemo: false,
    signOut: jest.fn(),
  }),
}));

jest.mock('./AdminDataContext', () => ({ useAdminData: jest.fn() }));

const renderWith = (data) => {
  useAdminData.mockReturnValue({
    mode: 'live', seedSampleData: jest.fn(), ...data,
  });
  return render(<MemoryRouter><Settings /></MemoryRouter>);
};

test.each([
  ['floors is an empty array', []],
  ['floors is undefined', undefined],
  ['floors is null', null],
])('renders with building === null when %s', (_, floors) => {
  renderWith({ building: null, floors });

  expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
  expect(screen.getByText('No building yet. Load the sample building below to get started.')).toBeInTheDocument();
  expect(screen.getByText('0 loaded (total_floors: —)')).toBeInTheDocument();
  expect(screen.getByText('Never')).toBeInTheDocument();
  expect(screen.getByText('Not set')).toBeInTheDocument();
  expect(screen.getByText(/There are no buildings in the database yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Load sample building' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Logout' })).toBeEnabled();
});

test('a minimal building (no optional fields) shows defaults', () => {
  renderWith({ building: { building_id: 'ENG_MAIN', building_name: 'Engineering Main Building' }, floors: [] });

  expect(screen.getByText('Engineering Main Building')).toBeInTheDocument();
  expect(screen.getByText('Auto')).toBeInTheDocument();
  expect(screen.getByText('Default (10 units = 1 m)')).toBeInTheDocument();
  expect(screen.getByText('Defaults')).toBeInTheDocument();
  expect(screen.getByText(/"ENG_MAIN" has no floors yet/)).toBeInTheDocument();
  expect(screen.queryByText(/No building yet/)).not.toBeInTheDocument();
});
