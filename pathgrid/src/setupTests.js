// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

// React Router v7 needs TextEncoder/TextDecoder, which CRA's jsdom (Jest 27)
// does not provide.
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;

// jsdom has no canvas implementation and logs "Not implemented" errors when
// getContext() is called. Components already handle a null context, so stub
// it to keep test output clean.
HTMLCanvasElement.prototype.getContext = () => null;
