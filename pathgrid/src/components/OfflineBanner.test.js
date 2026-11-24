import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import OfflineBanner, { RECONNECTED_MESSAGE_MS } from './OfflineBanner';
import AppHeader from './AppHeader';

let online = true;

beforeEach(() => {
  online = true;
  // CRA resets mocks between tests, so the getter is re-spied every time.
  jest.spyOn(window.navigator, 'onLine', 'get').mockImplementation(() => online);
});

afterEach(() => {
  jest.useRealTimers();
});

const goOffline = () => act(() => {
  online = false;
  window.dispatchEvent(new Event('offline'));
});

const goOnline = () => act(() => {
  online = true;
  window.dispatchEvent(new Event('online'));
});

describe('OfflineBanner', () => {
  test('renders nothing while online', () => {
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  test('appears when the browser starts offline', () => {
    online = false;
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent("You're offline. Maps you've already opened still work");
  });

  test('reacts to offline and online events', () => {
    render(<OfflineBanner />);
    goOffline();
    expect(screen.getByRole('status')).toHaveTextContent(/You're offline/);

    goOnline();
    expect(screen.getByRole('status')).toHaveTextContent('Back online');
    expect(screen.queryByText(/You're offline/)).not.toBeInTheDocument();
  });

  test('the "Back online" confirmation disappears on its own', () => {
    jest.useFakeTimers();
    render(<OfflineBanner />);
    goOffline();
    goOnline();
    expect(screen.getByText('Back online')).toBeInTheDocument();

    act(() => { jest.advanceTimersByTime(RECONNECTED_MESSAGE_MS - 1); });
    expect(screen.getByText('Back online')).toBeInTheDocument();
    act(() => { jest.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('going offline again cancels the reconnected message', () => {
    jest.useFakeTimers();
    render(<OfflineBanner />);
    goOffline();
    goOnline();
    goOffline();
    expect(screen.queryByText('Back online')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/You're offline/);
  });

  test('admin variant explains that changes cannot be saved', () => {
    online = false;
    render(<OfflineBanner variant="admin" />);
    expect(screen.getByRole('status')).toHaveTextContent("Changes can't be saved until your connection returns.");
  });

  test('stops listening after unmount', () => {
    const removeSpy = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<OfflineBanner />);
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
  });
});

describe('public header integration', () => {
  test('every page using AppHeader shows the offline strip below the header', () => {
    render(<MemoryRouter><AppHeader subtitle="Engineering Complex" /></MemoryRouter>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    goOffline();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/routes are calculated on your device/);
  });
});
