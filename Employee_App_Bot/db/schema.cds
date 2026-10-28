namespace my.company;

entity Departments {
  key ID          : UUID;
      name        : String;
      code        : String;
      employees   : Association to many Employees on employees.department = $self;
}

entity Employees {
  key ID          : UUID;
      name        : String;
      email       : String;
      role        : String;
      salary      : Decimal(10,2);
      department  : Association to Departments;
      projects    : Association to many EmployeeProjects on projects.employee = $self;
}

entity Projects {
  key ID          : UUID;
      title       : String;
      description : String;
      budget      : Decimal(12,2);
      employees   : Association to many EmployeeProjects on employees.project = $self;
}

// Association table for Employees <-> Projects (Many-to-Many)
entity EmployeeProjects {
  key ID      : UUID;
      employee : Association to Employees;
      project  : Association to Projects;
}