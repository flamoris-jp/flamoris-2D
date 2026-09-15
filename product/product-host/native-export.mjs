import { planEvaluatedExportFrames } from '../src/core/export-frame-evaluator.js';
import { exportResolutionPresets, exportFrameRatePresets } from '../src/core/export-settings.js';
import { createProjectCanvasRenderTarget } from '../src/core/composition-render-target.js';
import { exportFrameFileName, FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY } from '../src/core/frame-sequence-contract.js';
import { buildH264MfEncodeArgs, parseFfmpegCapability, assertOfficialFfmpegCapability, VIDEO_ENCODER_PROFILE } from '../src/core/video-encoder.js';
import { evaluatedProjection } from './evaluated-projection.mjs';
export function nativeExportSettings(session) {
 return {resolutions:exportResolutionPresets(session.project),frameRates:exportFrameRatePresets(session.project),
  renderSettings:session.query('project.get_render_settings'),canvas:session.project.canvas,videoProfile:VIDEO_ENCODER_PROFILE,partialOutputPolicy:FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY};
}
export function nativeExportPlan(session,input) {
 if(Boolean(input.sequenceId)===Boolean(input.transitionId))throw new Error('Select exactly one Sequence or Transition for export.');
 const plan=planEvaluatedExportFrames(session.project,input,input.frameRate);
 const target=createProjectCanvasRenderTarget({projectWidth:session.project.canvas.width,projectHeight:session.project.canvas.height,
  outputWidth:input.width,outputHeight:input.height});
 if(target.width>4096||target.height>4096||target.width*target.height>8294400)throw new Error('Native export supports up to 8,294,400 pixels, maximum dimension 4096.');
 if(input.video&&(target.width%2||target.height%2))throw new Error('H.264 output dimensions must be even.');
 return {...plan.describe(),target,partialOutputPolicy:FRAME_SEQUENCE_PARTIAL_OUTPUT_POLICY};
}
export function nativeExportFrame(document,assets,input) {
 const plan=nativeExportPlan(document.session,input);
 const frame=planEvaluatedExportFrames(document.session.project,input,input.frameRate).frameAt(input.frameIndex);
 const projection=evaluatedProjection(document,assets,{sequenceId:input.sequenceId,transitionId:input.transitionId,timeTicks:frame.timeTicks});
 if(projection.diagnostics.some(d=>d.severity==='error'))throw new Error('Export evaluation contains structural diagnostics.');
 return {...projection,frame,fileName:exportFrameFileName(input.frameIndex),target:plan.target};
}
export function nativeEncoderContract(input) {
 if(input.probe)return assertOfficialFfmpegCapability(parseFfmpegCapability(input.probe));
 return {args:buildH264MfEncodeArgs(input),profile:VIDEO_ENCODER_PROFILE};
}
