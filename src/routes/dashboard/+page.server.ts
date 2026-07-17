import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { load as rootLoad, actions as rootActions } from '../+page.server';

export const load: PageServerLoad = async (event) => {
    const data = await rootLoad(event as never) as any;
    if (data.loggedIn && data.userRole !== 'admin' && data.userRole !== 'staff') {
        throw error(404);
    }
    return data;
};

export const actions: Actions = rootActions as unknown as Actions;
