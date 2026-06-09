import challengesData from "@/data/challenges.json";
import type { Challenge } from "@/lib/types";

const challenges = challengesData as Challenge[];

export function getAllChallenges(): Challenge[] {
  return challenges;
}

export function getChallengeById(id: number): Challenge | undefined {
  return challenges.find((c) => c.id === id);
}

export function getRandomChallenge(): Challenge {
  const index = Math.floor(Math.random() * challenges.length);
  return challenges[index];
}

export function getRecreationVideo(
  challenge: Challenge,
  score: number
): string {
  if (score < 40) return challenge.recreationVideos.low;
  if (score <= 75) return challenge.recreationVideos.medium;
  return challenge.recreationVideos.high;
}
