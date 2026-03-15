import { mount } from 'svelte';
import LibraryApp from './LibraryApp.svelte';
import '../app.css';

mount(LibraryApp, { target: document.getElementById('app')! });
