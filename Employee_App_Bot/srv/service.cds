using { my.company as my } from '../db/schema';

service EmployeeService {
  entity Departments as projection on my.Departments;
  entity Employees   as projection on my.Employees;
  entity Projects    as projection on my.Projects;
  entity EmployeeProjects as projection on my.EmployeeProjects;

  // Custom action for your chatbot requests
  action askEmployeeBot(prompt : String) returns String;

  // New Dedicated Groq Chatbot Action
  action askGroqBot(prompt : String, history: String) returns String;

  action askGroqBot2(prompt : String, history: String) returns String;
}