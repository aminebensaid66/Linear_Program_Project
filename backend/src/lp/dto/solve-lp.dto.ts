import { IsString, MaxLength, MinLength } from "class-validator";

export class SolveLpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(12000)
  problem!: string;
}