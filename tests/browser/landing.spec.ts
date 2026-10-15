import {test,expect} from '@playwright/test';

test('wikangtagalog.com is the download page: one click to the installer for this computer, none of the app',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const loaded:string[]=[];page.on('request',r=>loaded.push(r.url()));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Wikang Tagalog',level:1})).toBeVisible();
 const get=page.getByRole('link',{name:/^Download for (Windows|Mac)$/});
 await expect(get).toHaveAttribute('href',/^\/api\/download\?platform=(windows|mac)$/);
 await expect(page.getByRole('link',{name:/^(Windows|Mac) instead$/})).toBeVisible();
 // the app (reader, sign-in, guest learning) is not here, and is never loaded
 await expect(page.getByText('Continue as a guest')).toHaveCount(0);
 expect(loaded.some(u=>/\/src\/start\.tsx|\/src\/App\.tsx/.test(u))).toBe(false);
 expect(errors).toEqual([]);
});

test('arriving from a sign-up confirmation email says so, and the sign-in tokens leave the address bar',async({page})=>{
 await page.goto('/#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=signup');
 await expect(page.getByText('Your email is confirmed. Open Wikang Tagalog on your computer and sign in.')).toBeVisible();
 expect(new URL(page.url()).hash).toBe('');
});
