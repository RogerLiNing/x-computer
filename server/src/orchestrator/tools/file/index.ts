/**
 * file 类工具统一导出：file.read / file.write / file.tail / file.replace / file.parse / file.list
 */
import type { ToolDefinition } from '@x-computer/shared';
import type { ToolExecutorDeps, ToolHandler } from '../types.js';
import { fileReadDefinition, createFileReadHandler } from './read.js';
import { fileWriteDefinition, createFileWriteHandler } from './write.js';
import { fileTailDefinition, createFileTailHandler } from './tail.js';
import { fileReplaceDefinition, createFileReplaceHandler } from './replace.js';
import { fileParseDefinition, createFileParseHandler } from './parse.js';
import { fileListDefinition, createFileListHandler } from './list.js';

export const fileDefinitions: ToolDefinition[] = [
  fileReadDefinition,
  fileWriteDefinition,
  fileTailDefinition,
  fileReplaceDefinition,
  fileParseDefinition,
  fileListDefinition,
];

export function createFileHandlers(deps: ToolExecutorDeps): Map<string, ToolHandler> {
  const map = new Map<string, ToolHandler>();
  map.set(fileReadDefinition.name, createFileReadHandler(deps));
  map.set(fileWriteDefinition.name, createFileWriteHandler(deps));
  map.set(fileTailDefinition.name, createFileTailHandler(deps));
  map.set(fileReplaceDefinition.name, createFileReplaceHandler(deps));
  map.set(fileParseDefinition.name, createFileParseHandler(deps));
  map.set(fileListDefinition.name, createFileListHandler(deps));
  return map;
}
