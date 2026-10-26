import { describe, expect, it } from 'vitest';
import { buildRenderPrompt } from './renderPrompt';
import { mastroxLayout, sampleFactory } from './sample';

describe('factory render prompt', () => {
  // Pinned before the interior prompt was added: a factory must keep the exact same prompt, letter for letter.
  it('the sample factory gives the same prompt as before', () => {
    expect(buildRenderPrompt(sampleFactory())).toMatchSnapshot();
  });
  it('the Mastrox layout gives the same prompt as before', () => {
    expect(buildRenderPrompt(mastroxLayout())).toMatchSnapshot();
  });
});
