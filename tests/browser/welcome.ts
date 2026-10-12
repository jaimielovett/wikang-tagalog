import {expect, type Page} from '@playwright/test';
export async function completeWelcome(page: Page, name = '', goal = 10) {
 await page.getByRole('button', {name:'Get started',exact:true}).click();
 await expect(page.getByRole('heading',{name:"Let's get acquainted"})).toBeVisible();
 if (name) await page.getByRole('textbox',{name:'Your first name or a nickname'}).fill(name);
 await page.getByRole('button',{name:name ? 'Continue' : 'Later',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A little Tagalog, every day'})).toBeVisible();
 await page.getByRole('button',{name:`${goal} minutes`,exact:false}).click();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Your reading, with a little help'})).toBeVisible();
 await expect(page.getByText(/There are no browser models to install/)).toBeVisible();
 await page.getByRole('button',{name:'Continue',exact:true}).click();
 await expect(page.getByRole('heading',{name:/your first story is ready/i})).toBeVisible();
 await page.getByRole('button',{name:'Open my first reading',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Guided tour'})).toBeVisible({timeout:10000});
 await page.getByRole('button',{name:'Skip the tour',exact:true}).click();
 await expect(page.locator('.reader')).toBeVisible();
}
