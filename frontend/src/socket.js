import { io } from 'socket.io-client';
const API_BASE = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:5000`;
const socket = io(API_BASE);
export default socket;
