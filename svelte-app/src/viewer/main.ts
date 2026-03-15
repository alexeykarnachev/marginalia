import { mount } from 'svelte';
import ViewerApp from './ViewerApp.svelte';
import '../app.css';

mount(ViewerApp, { target: document.getElementById('app')! });
